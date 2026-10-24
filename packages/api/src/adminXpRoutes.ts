import express from "express";
import type { Store } from "./store";
import type { UserRow } from "./userMe";
import { progressFromLifetime, toProgress } from "./xp/rules";

const MAX_LIFETIME_XP = 1_000_000_000;

/** Root-only XP view and fix (U2.8). Mounted before mountGameRoutes' catch-all 404. */
export function mountAdminXpRoutes(
  app: express.Express,
  d: {
    store: Store;
    authenticate(
      req: express.Request,
    ): Promise<{ user: UserRow; role: unknown } | null>;
  },
): void {
  const { store, authenticate } = d;
  const json = express.json({ limit: "16kb" });

  const handle =
    (
      run: (
        req: express.Request,
        res: express.Response,
        actor: UserRow,
        target: UserRow,
      ) => Promise<void>,
    ) =>
    async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      try {
        const auth = await authenticate(req);
        if (!auth) return void res.status(401).json({ error: "unauthorized" });
        if (auth.role !== "root" || auth.user.rank !== "THE_STRONGEST") {
          return void res.status(403).json({ error: "forbidden" });
        }
        const target = await store.findUserByUsername(
          String(req.params.username).trim(),
        );
        if (!target)
          return void res.status(404).json({ error: "no_such_user" });
        await run(req, res, auth.user, target);
      } catch (e) {
        next(e);
      }
    };

  const view = async (res: express.Response, u: UserRow) => {
    res.json({
      username: u.username,
      publicId: u.public_id,
      progress: toProgress(await store.getProgress(u.id)),
      games: await store.countGames(u.id),
    });
  };

  app.get(
    "/admin/users/:username/progress",
    handle(async (_req, res, _actor, target) => view(res, target)),
  );

  app.post(
    "/admin/users/:username/progress",
    json,
    handle(async (req, res, actor, target) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const set = body.action === "set";
      const lifetimeXp = body.lifetimeXp;
      if (
        body.action !== "reset" &&
        !(
          set &&
          typeof lifetimeXp === "number" &&
          Number.isInteger(lifetimeXp) &&
          lifetimeXp >= 0 &&
          lifetimeXp <= MAX_LIFETIME_XP
        )
      ) {
        return void res.status(400).json({ error: "invalid_request" });
      }
      const before = await store.getProgress(target.id);
      const after = progressFromLifetime(set ? (lifetimeXp as number) : 0);
      await store.setProgress(target.id, after, !set);
      await store.logAdmin({
        actor: actor.username,
        action: set ? "xp_set" : "xp_reset",
        target: target.username,
        detail: { before, after },
      });
      await view(res, target);
    }),
  );
}
