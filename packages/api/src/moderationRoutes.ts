import { base64urlToUuid } from "@openfront/shared/Base64";
import express from "express";
import { requireApiKey } from "./apiKey";
import { isBanned } from "./bans";
import type { ApiEnv } from "./env";
import type { RateLimits } from "./rateLimit";
import type { Store } from "./store";
import type { UserRow } from "./userMe";

const MIN_MS = 60_000;
const MAX_MINUTES = 5 * 365 * 24 * 60;
const MAX_BANNER = 200;
const MAX_REASON = 200;
const MAX_MESSAGE = 200;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isMinutes = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_MINUTES;
const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.length <= max ? v : null;

/** A JWT `sub` (base64url UUID) to the user, or null for a bad or unknown one. */
async function userBySub(store: Store, sub: unknown): Promise<UserRow | null> {
  if (typeof sub !== "string" || sub.length > 40) return null;
  let id: string;
  try {
    id = base64urlToUuid(sub);
  } catch {
    return null;
  }
  return UUID_RE.test(id) ? store.findUserById(id) : null;
}

/**
 * Root moderation: bans, chat mutes, site status, chat reports, unranked
 * games, plus the game server's key-only lookups. Every root action writes one
 * admin_audit row. Mounted before mountGameRoutes' catch-all 404.
 */
export function mountModerationRoutes(
  app: express.Express,
  d: {
    env: Pick<ApiEnv, "apiKey">;
    store: Store;
    authenticate(
      req: express.Request,
    ): Promise<{ user: UserRow; role: unknown } | null>;
    limits: Pick<RateLimits, "admin">;
  },
): void {
  const { store, authenticate } = d;
  const json = express.json({ limit: "16kb" });
  const serverOnly = requireApiKey(d.env.apiKey);

  type Run = (
    req: express.Request,
    res: express.Response,
    actor: UserRow,
  ) => Promise<void>;
  const root =
    (run: Run): express.RequestHandler =>
    async (req, res, next) => {
      try {
        const auth = await authenticate(req);
        if (!auth) return void res.status(401).json({ error: "unauthorized" });
        if (auth.role !== "root" || auth.user.rank !== "THE_STRONGEST") {
          return void res.status(403).json({ error: "forbidden" });
        }
        if (!d.limits.admin.hit(auth.user.id)) {
          return void res.status(429).json({ error: "rate_limited" });
        }
        await run(req, res, auth.user);
      } catch (e) {
        next(e);
      }
    };
  const bodyOf = (req: express.Request) =>
    (req.body ?? {}) as Record<string, unknown>;
  const bad = (res: express.Response) =>
    void res.status(400).json({ error: "invalid_request" });

  /** A root action on a named account. */
  const onUser = (
    run: (
      req: express.Request,
      res: express.Response,
      actor: UserRow,
      target: UserRow,
    ) => Promise<void>,
  ) =>
    root(async (req, res, actor) => {
      const target = await store.findUserByUsername(
        String(req.params.username).trim(),
      );
      if (!target) return void res.status(404).json({ error: "no_such_user" });
      await run(req, res, actor, target);
    });
  const audit = (
    actor: UserRow,
    action: string,
    target: string | null,
    detail?: Record<string, unknown>,
  ) => store.logAdmin({ actor: actor.username, action, target, detail });

  app.post(
    "/admin/users/:username/ban",
    json,
    onUser(async (req, res, actor, target) => {
      const { minutes } = bodyOf(req);
      const reason = bodyOf(req).reason ?? null;
      if (
        (minutes !== null && !isMinutes(minutes)) ||
        (reason !== null && str(reason, MAX_REASON) === null)
      ) {
        return bad(res);
      }
      if (target.rank === "THE_STRONGEST") {
        return void res.status(403).json({ error: "protected_account" });
      }
      const until =
        minutes === null
          ? "infinity"
          : new Date(Date.now() + (minutes as number) * MIN_MS);
      await store.setBan(target.id, until, reason as string | null);
      await store.revokeAllForUser(target.id);
      await audit(actor, "ban", target.username, { minutes, reason });
      res.json({ ok: true });
    }),
  );

  app.post(
    "/admin/users/:username/unban",
    onUser(async (_req, res, actor, target) => {
      await store.setBan(target.id, null, null);
      await audit(actor, "unban", target.username);
      res.json({ ok: true });
    }),
  );

  app.post(
    "/admin/users/:username/mute",
    json,
    onUser(async (req, res, actor, target) => {
      const { minutes, shadow } = bodyOf(req);
      if (
        !isMinutes(minutes) ||
        (shadow !== undefined && typeof shadow !== "boolean")
      ) {
        return bad(res);
      }
      await store.setMute(
        target.id,
        new Date(Date.now() + minutes * MIN_MS),
        shadow === true,
      );
      await audit(actor, "mute", target.username, {
        minutes,
        shadow: shadow === true,
      });
      res.json({ ok: true });
    }),
  );

  app.post(
    "/admin/users/:username/unmute",
    onUser(async (_req, res, actor, target) => {
      await store.setMute(target.id, null, false);
      await audit(actor, "unmute", target.username);
      res.json({ ok: true });
    }),
  );

  // --- site status ---
  const siteStatus = async () => {
    const v = ((await store.getSetting("site_status")) ?? {}) as {
      banner?: unknown;
      maintenance?: unknown;
    };
    return {
      banner: typeof v.banner === "string" ? v.banner : null,
      maintenance: v.maintenance === true,
    };
  };
  app.get(
    "/admin/site-status",
    root(async (_req, res) => void res.json(await siteStatus())),
  );
  app.put(
    "/admin/site-status",
    json,
    root(async (req, res, actor) => {
      const { banner, maintenance } = bodyOf(req);
      if (
        (banner !== null && str(banner, MAX_BANNER) === null) ||
        typeof maintenance !== "boolean"
      ) {
        return bad(res);
      }
      const next = { banner: banner as string | null, maintenance };
      await store.setSetting("site_status", next, actor.username);
      await audit(actor, "site_status", null, next);
      res.json(next);
    }),
  );
  app.get("/public/site-status", async (_req, res, next) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=5");
      res.json(await siteStatus());
    } catch (e) {
      next(e);
    }
  });

  // --- chat reports ---
  app.get(
    "/admin/chat-reports",
    root(async (_req, res) => {
      res.json({ reports: await store.listChatReports() });
    }),
  );
  app.delete(
    "/admin/chat-reports/:id",
    root(async (req, res, actor) => {
      const id = String(req.params.id);
      if (!UUID_RE.test(id) || !(await store.deleteChatReport(id))) {
        return void res.status(404).json({ error: "not_found" });
      }
      await audit(actor, "chat_report_delete", id);
      res.json({ ok: true });
    }),
  );

  // --- unranked games ---
  app.post(
    "/admin/games/:id/unranked",
    json,
    root(async (req, res, actor) => {
      const reason = bodyOf(req).reason ?? "admin";
      if (str(reason, MAX_REASON) === null) return bad(res);
      const id = String(req.params.id);
      if (!(await store.setGameUnranked(id, reason as string))) {
        return void res.status(404).json({ error: "not_found" });
      }
      await audit(actor, "game_unranked", id, { reason });
      res.json({ ok: true });
    }),
  );

  // --- game server (API key only; a JWT is refused) ---
  app.get(
    "/game-server/moderation/:sub",
    serverOnly,
    async (req, res, next) => {
      try {
        const u = await userBySub(store, req.params.sub);
        const muted =
          u?.chat_muted_until && Number(u.chat_muted_until) > Date.now()
            ? new Date(u.chat_muted_until)
            : null;
        res.json({
          banned: !!u && isBanned(u),
          mutedUntil: muted ? muted.toISOString() : null,
          shadow: !!muted && u?.chat_shadow_muted === true,
        });
      } catch (e) {
        next(e);
      }
    },
  );

  app.post("/game-server/audit", serverOnly, json, async (req, res, next) => {
    try {
      const { actor, action, target, detail } = bodyOf(req);
      const a = str(actor, 64);
      const act = str(action, 64);
      const t =
        target === null || target === undefined ? null : str(target, 200);
      if (
        !a ||
        !act ||
        (target !== undefined && target !== null && t === null) ||
        (detail !== undefined &&
          (typeof detail !== "object" ||
            detail === null ||
            Array.isArray(detail)))
      ) {
        return bad(res);
      }
      await store.logAdmin({
        actor: a,
        action: act,
        target: t,
        detail: detail as Record<string, unknown> | undefined,
      });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  app.post(
    "/game-server/chat-report",
    serverOnly,
    json,
    async (req, res, next) => {
      try {
        const { gameId, reporterSub, targetSub, message } = bodyOf(req);
        const g = str(gameId, 64);
        const m = str(message, MAX_MESSAGE);
        const reporter = await userBySub(store, reporterSub);
        const target = await userBySub(store, targetSub);
        if (!g || !m || !reporter || !target) return bad(res);
        await store.addChatReport({
          gameId: g,
          reporterId: reporter.id,
          targetId: target.id,
          message: m,
        });
        res.status(201).json({ ok: true });
      } catch (e) {
        next(e);
      }
    },
  );
}
