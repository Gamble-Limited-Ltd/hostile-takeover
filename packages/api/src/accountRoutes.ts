import { uuidToBase64url } from "@openfront/shared/Base64";
import express from "express";
import type { AppContext } from "./app";
import { profanityMatcher } from "./censor";
import { checkPassword, hashPassword, verifyPassword } from "./passwords";
import { generatePublicId } from "./publicId";
import type { RateLimits } from "./rateLimit";
import { createPasswordReset } from "./resets";
import { hashRefreshToken } from "./tokens";
import type { UserRow } from "./userMe";

export const EMAIL_RE = /^[^@\s]+@kmlhs\.org$/i;
// The client's AccountUsernameSchema (src/client/validations/username.ts):
// 3-20 chars of [a-zA-Z0-9_-], single spaces between words allowed.
export const USERNAME_RE = /^[a-zA-Z0-9_-]+( [a-zA-Z0-9_-]+)*$/;
const MAX_NAME = 50;
const MAX_EMAIL = 254;

export interface AccountDeps {
  ctx: AppContext;
  limits: RateLimits;
  startSession(
    res: express.Response,
    userId: string,
    userAgent: string | undefined,
  ): Promise<void>;
  clearRefreshCookie(res: express.Response): void;
  readRefreshCookie(req: express.Request): string | null;
  /** The user behind a valid Bearer JWT, with its claims. */
  authenticate(
    req: express.Request,
  ): Promise<{ user: UserRow; role: unknown } | null>;
}

export const ipOf = (req: express.Request) => req.ip ?? "unknown";
export const bodyOf = (req: express.Request): Record<string, unknown> =>
  req.body && typeof req.body === "object" ? req.body : {};

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Format + censor check shared by register and rename; returns the trimmed name. */
export function checkUsername(
  raw: unknown,
): { error: "username_invalid" | "username_censored" } | { username: string } {
  const username = str(raw)?.trim() ?? "";
  if (
    username.length < 3 ||
    username.length > 20 ||
    !USERNAME_RE.test(username)
  ) {
    return { error: "username_invalid" };
  }
  if (profanityMatcher.hasMatch(username))
    return { error: "username_censored" };
  return { username };
}

/** Self-service rename: once per 7 days. */
export const USERNAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** Validates the register body; returns a stable error code or the clean values. */
export function validateRegister(body: Record<string, unknown>):
  | { error: string }
  | {
      firstName: string;
      lastName: string;
      email: string;
      username: string;
      password: string;
    } {
  const firstName = str(body.firstName)?.trim() ?? "";
  const lastName = str(body.lastName)?.trim() ?? "";
  if (firstName.length < 1 || firstName.length > MAX_NAME) {
    return { error: "first_name_invalid" };
  }
  if (lastName.length < 1 || lastName.length > MAX_NAME) {
    return { error: "last_name_invalid" };
  }
  const email = str(body.email)?.trim() ?? "";
  if (email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return { error: "email_domain" };
  }
  const checked = checkUsername(body.username);
  if ("error" in checked) return checked;
  const username = checked.username;
  const pw = checkPassword(body.password);
  if (pw) return { error: pw };
  if (body.ageConfirmed !== true) return { error: "age_unconfirmed" };
  return {
    firstName,
    lastName,
    email,
    username,
    password: body.password as string,
  };
}

export function mountAccountRoutes(app: express.Express, d: AccountDeps): void {
  const { store, env } = d.ctx;
  const json = express.json({ limit: "16kb" });
  const tooMany = (res: express.Response) =>
    void res.status(429).json({ error: "rate_limited" });

  const legacyOff = (res: express.Response) =>
    !env.legacyLogin &&
    void res.status(403).json({ error: "legacy_login_disabled" });

  app.post("/auth/register", json, async (req, res, next) => {
    try {
      if (legacyOff(res)) return;
      const body = bodyOf(req);
      const ipOk = d.limits.registerIp.hit(ipOf(req));
      if (!ipOk) return tooMany(res);

      const v = validateRegister(body);
      if ("error" in v) return void res.status(400).json({ error: v.error });

      const created = await store.createUser({
        publicId: generatePublicId(),
        username: v.username,
        firstName: v.firstName,
        lastName: v.lastName,
        email: v.email,
        passwordHash: await hashPassword(v.password),
      });
      if (!created.ok) {
        return void res.status(409).json({
          error: created.taken === "email" ? "email_taken" : "username_taken",
        });
      }
      await d.startSession(res, created.user.id, req.headers["user-agent"]);
      res
        .status(201)
        .json({ ok: true, userId: uuidToBase64url(created.user.id) });
    } catch (e) {
      next(e);
    }
  });

  app.post("/auth/login", json, async (req, res, next) => {
    try {
      if (legacyOff(res)) return;
      const body = bodyOf(req);
      const login = str(body.usernameOrEmail)?.trim() ?? "";
      const password = str(body.password) ?? "";
      // Keyed on account+IP so one IP can't lock the name for everyone.
      const acctKey = `${login.toLowerCase()}|${ipOf(req)}`;
      // IP: every attempt counts. Account: failures only, cleared on success.
      if (
        !d.limits.loginIp.hit(ipOf(req)) ||
        d.limits.loginAccount.blocked(acctKey)
      ) {
        return tooMany(res);
      }
      const fail = () => {
        d.limits.loginAccount.hit(acctKey);
        res.status(401).json({ error: "invalid_credentials" });
      };
      if (
        login === "" ||
        login.length > 254 ||
        password === "" ||
        password.length > 1024
      ) {
        await verifyPassword(null, password.slice(0, 128));
        return fail();
      }
      const cred = await store.findCredentials(login);
      const ok = await verifyPassword(cred?.passwordHash ?? null, password);
      if (!cred || !ok || cred.user.disabled_at) return fail();
      d.limits.loginAccount.reset(acctKey);
      await d.startSession(res, cred.user.id, req.headers["user-agent"]);
      res.json({ ok: true, userId: uuidToBase64url(cred.user.id) });
    } catch (e) {
      next(e);
    }
  });

  // The client calls this with the refresh cookie and no Authorization header
  // (src/client/Api.ts deleteAccount); a Bearer JWT works too.
  app.delete("/users/@me", async (req, res, next) => {
    try {
      let user: UserRow | null = null;
      const raw = d.readRefreshCookie(req);
      if (raw) {
        const s = await store.findSessionByHash(hashRefreshToken(raw));
        if (s && !s.revoked_at && s.expires_at.getTime() > Date.now()) {
          user = await store.findUserById(s.user_id);
        }
      } else {
        user = (await d.authenticate(req))?.user ?? null;
      }
      if (!user || user.disabled_at) {
        d.clearRefreshCookie(res);
        return void res.status(401).json({ error: "unauthorized" });
      }
      await store.deleteUser(user.id);
      d.clearRefreshCookie(res);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  app.patch("/users/@me/password", json, async (req, res, next) => {
    try {
      const auth = await d.authenticate(req);
      if (!auth) return void res.status(401).json({ error: "unauthorized" });
      const body = bodyOf(req);
      if (!d.limits.loginAccount.hit(`pw:${auth.user.id}`)) return tooMany(res);
      const hashed = await store.findPasswordHash(auth.user.id);
      const current = str(body.currentPassword) ?? "";
      if (current.length > 1024 || !(await verifyPassword(hashed, current))) {
        return void res.status(403).json({ error: "wrong_password" });
      }
      const problem = checkPassword(body.newPassword);
      if (problem) return void res.status(400).json({ error: problem });
      await store.setPassword(
        auth.user.id,
        await hashPassword(body.newPassword as string),
      );
      // Sign out everywhere, then give this browser a fresh session so the
      // caller stays signed in (their JWT stays valid until it expires).
      await store.revokeAllForUser(auth.user.id);
      await d.startSession(res, auth.user.id, req.headers["user-agent"]);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  app.post("/admin/password-resets", json, async (req, res, next) => {
    try {
      const auth = await d.authenticate(req);
      if (!auth) return void res.status(401).json({ error: "unauthorized" });
      if (auth.role !== "root" || auth.user.rank !== "THE_STRONGEST") {
        return void res.status(403).json({ error: "forbidden" });
      }
      const username = str(bodyOf(req).username)?.trim() ?? "";
      const r = username
        ? await createPasswordReset(store, env, {
            username,
            actor: auth.user.username,
            createdBy: auth.user.id,
          })
        : null;
      if (!r) return void res.status(404).json({ error: "no_such_user" });
      res.status(201).json({
        token: r.token,
        link: r.link,
        expiresAt: r.expiresAt.toISOString(),
      });
    } catch (e) {
      next(e);
    }
  });

  // The client (src/client/Api.ts updateUsername) maps 400 USERNAME_PROFANE ->
  // profane, other 400 -> invalid (+reason), 409 -> taken, 429 + Retry-After ->
  // cooldown. HT has no numbered-suffix names, so a taken name is a plain 409.
  // GATE (GLL ID) is never told: HT owns the username.
  app.put("/users/@me/username", json, async (req, res, next) => {
    try {
      const auth = await d.authenticate(req);
      if (!auth) return void res.status(401).json({ error: "unauthorized" });
      if (!d.limits.usernameChange.hit(auth.user.id)) return tooMany(res);
      const checked = checkUsername(bodyOf(req).username);
      if ("error" in checked) {
        return void res.status(400).json(
          checked.error === "username_censored"
            ? { code: "USERNAME_PROFANE" }
            : {
                code: "USERNAME_INVALID",
                reason:
                  "Usernames are 3-20 characters: letters, numbers, spaces, - and _.",
              },
        );
      }
      const r = await store.renameUser(auth.user.id, checked.username, {
        cooldownMs: USERNAME_COOLDOWN_MS,
      });
      if (!r.ok) {
        if (r.taken)
          return void res.status(409).json({ code: "USERNAME_TAKEN" });
        res.set(
          "Retry-After",
          String(
            Math.max(1, Math.ceil((r.retryAt.getTime() - Date.now()) / 1000)),
          ),
        );
        return void res.status(429).json({ code: "USERNAME_COOLDOWN" });
      }
      res.json({
        username: r.user.username,
        base: r.user.username,
        discriminator: "",
        usernameStatus: "unclaimed",
        nextUsernameChangeAt: new Date(
          (r.user.username_changed_at ?? new Date()).getTime() +
            USERNAME_COOLDOWN_MS,
        ).toISOString(),
      });
    } catch (e) {
      next(e);
    }
  });

  // Root renames any player, any time (no cooldown, and theirs is not spent).
  app.post("/admin/users/:username/rename", json, async (req, res, next) => {
    try {
      const auth = await d.authenticate(req);
      if (!auth) return void res.status(401).json({ error: "unauthorized" });
      if (auth.role !== "root" || auth.user.rank !== "THE_STRONGEST") {
        return void res.status(403).json({ error: "forbidden" });
      }
      const target = await store.findUserByUsername(req.params.username);
      if (!target) return void res.status(404).json({ error: "no_such_user" });
      const checked = checkUsername(bodyOf(req).username);
      if ("error" in checked) {
        return void res.status(400).json({ error: checked.error });
      }
      const from = target.username;
      const r = await store.renameUser(target.id, checked.username, {
        cooldownMs: null,
      });
      if (!r.ok) return void res.status(409).json({ error: "username_taken" });
      await store.logAdmin({
        actor: auth.user.username,
        action: "user.rename",
        target: from,
        detail: { userId: target.id, to: r.user.username },
      });
      res.json({ username: r.user.username });
    } catch (e) {
      next(e);
    }
  });

  app.post("/auth/reset", json, async (req, res, next) => {
    try {
      if (!d.limits.resetIp.hit(ipOf(req))) return tooMany(res);
      const body = bodyOf(req);
      const token = str(body.token) ?? "";
      const problem = checkPassword(body.newPassword);
      if (problem) return void res.status(400).json({ error: problem });
      const userId =
        token.length > 200
          ? null
          : await store.consumeReset(
              hashRefreshToken(token),
              await hashPassword(body.newPassword as string),
            );
      if (!userId) return void res.status(400).json({ error: "invalid_token" });
      await store.revokeAllForUser(userId);
      d.clearRefreshCookie(res);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
}
