// "Sign in with GLL ID": the browser routes. HT mints its own refresh cookie
// and JWT afterwards (startSession), so the game and its WebSocket code never
// see GATE.
import { uuidToBase64url } from "@openfront/shared/Base64";
import express from "express";
import { USERNAME_RE } from "./accountRoutes";
import type { AppContext } from "./app";
import { profanityMatcher } from "./censor";
import {
  GateError,
  pkceChallenge,
  randomToken,
  sha256Hex,
  type DirectResult,
  type GateClient,
  type GateIdentity,
} from "./gate";
import { verifyPassword } from "./passwords";
import { generatePublicId } from "./publicId";
import { RateLimiter, type RateLimits } from "./rateLimit";
import type { GatePendingRow } from "./store";

export const GATE_FLOW_COOKIE = "ht_gate_flow";
export const GATE_PENDING_COOKIE = "ht_gate_pending";
/** Set by /auth/gate/start?tab=1: the sign-in runs in a new tab. */
export const GATE_TAB_COOKIE = "ht_gate_tab";
const FLOW_TTL_MS = 10 * 60_000;
const PENDING_TTL_MS = 15 * 60_000;

export interface GateDeps {
  ctx: AppContext;
  gate: GateClient;
  limits: RateLimits;
  startSession(
    res: express.Response,
    userId: string,
    userAgent: string | undefined,
  ): Promise<void>;
  readCookie(req: express.Request, name: string): string | null;
  /** The refresh cookie's secure / sameSite flags, reused for the GATE cookies. */
  cookieFlags: {
    secure: boolean;
    sameSite: "none" | "lax";
  };
}

export function mountGateRoutes(app: express.Express, d: GateDeps): void {
  const { store, env } = d.ctx;
  const { gate } = d;
  const json = express.json({ limit: "16kb" });
  const ipOf = (req: express.Request) => req.ip ?? "unknown";
  const bodyOf = (req: express.Request): Record<string, unknown> =>
    req.body && typeof req.body === "object" ? req.body : {};
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const cookieOpts = {
    path: "/auth/gate",
    httpOnly: true,
    secure: d.cookieFlags.secure,
    sameSite: d.cookieFlags.sameSite,
  };
  const back = (res: express.Response, hash: string, tab = false) => {
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, `${env.gameOrigin}/#${hash}${tab ? "&tab=1" : ""}`);
  };

  app.get("/auth/config", (_req, res) => {
    res.json({
      gate: gate.enabled,
      legacy: env.legacyLogin,
      // GLL ID's public address, for the Terms and Privacy links in the direct form.
      gateUrl: gate.enabled ? env.gateIssuer : "",
    });
  });

  app.get("/auth/gate/start", async (req, res, next) => {
    try {
      if (!gate.enabled) return back(res, "gate_error=disabled");
      const state = randomToken();
      const nonce = randomToken();
      const verifier = randomToken();
      const binding = randomToken();
      let url: string;
      try {
        url = await gate.authorizeUrl({
          state,
          nonce,
          codeChallenge: pkceChallenge(verifier),
        });
      } catch (e) {
        if (e instanceof GateError) return back(res, "gate_error=unavailable");
        throw e;
      }
      await store.createGateFlow({
        stateHash: sha256Hex(state),
        bindingHash: sha256Hex(binding),
        nonce,
        codeVerifier: verifier,
        expiresAt: new Date(Date.now() + FLOW_TTL_MS),
      });
      res.cookie(GATE_FLOW_COOKIE, binding, {
        ...cookieOpts,
        maxAge: FLOW_TTL_MS,
      });
      if (req.query.tab === "1") {
        res.cookie(GATE_TAB_COOKIE, "1", {
          ...cookieOpts,
          maxAge: FLOW_TTL_MS,
        });
      }
      res.setHeader("Cache-Control", "no-store");
      res.redirect(302, url);
    } catch (e) {
      next(e);
    }
  });

  /**
   * What happens once GATE has vouched for a player, whichever way they came
   * (the redirect callback or the direct sign-in): a linked account gets a
   * session; anyone else gets a pending identity to link or create from.
   */
  async function signInWho(
    req: express.Request,
    res: express.Response,
    who: GateIdentity,
  ): Promise<"ok" | "link" | "disabled"> {
    const user = await store.findUserByGateSub(who.sub);
    if (user) {
      if (user.disabled_at) return "disabled";
      if (who.email && who.email.toLowerCase() !== user.email.toLowerCase()) {
        await store.setEmailIfFree(user.id, who.email);
      }
      await store.setGateIdToken(user.id, who.idToken);
      await d.startSession(res, user.id, req.headers["user-agent"]);
      return "ok";
    }
    const token = randomToken();
    await store.createGatePending({
      tokenHash: sha256Hex(token),
      gateSub: who.sub,
      email: who.email,
      loginName: who.loginName,
      displayName: who.displayName,
      emailApproved: who.emailApproved,
      idToken: who.idToken,
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    });
    res.cookie(GATE_PENDING_COOKIE, token, {
      ...cookieOpts,
      maxAge: PENDING_TTL_MS,
    });
    return "link";
  }

  app.get("/auth/gate/callback", async (req, res, next) => {
    // The flow cookie is single use whatever happens.
    const tab = d.readCookie(req, GATE_TAB_COOKIE) === "1";
    const fail = (code: string) => {
      res.clearCookie(GATE_FLOW_COOKIE, cookieOpts);
      res.clearCookie(GATE_TAB_COOKIE, cookieOpts);
      back(res, `gate_error=${code}`, tab);
    };
    try {
      if (!gate.enabled) return fail("disabled");
      const q = req.query;
      if (typeof q.error === "string") {
        return fail(q.error === "access_denied" ? "denied" : "invalid");
      }
      const state = str(q.state);
      const code = str(q.code);
      const binding = d.readCookie(req, GATE_FLOW_COOKIE);
      if (!state || !code || !binding) return fail("invalid");
      if (state.length > 200 || code.length > 2000 || binding.length > 200) {
        return fail("invalid");
      }
      const flow = await store.consumeGateFlow(
        sha256Hex(state),
        sha256Hex(binding),
      );
      if (!flow) return fail("expired");
      if (q.iss !== env.gateIssuer) return fail("invalid");

      let who;
      try {
        who = await gate.exchange({
          code,
          codeVerifier: flow.codeVerifier,
          nonce: flow.nonce,
        });
      } catch (e) {
        if (e instanceof GateError) return fail(e.code);
        throw e;
      }

      const outcome = await signInWho(req, res, who);
      if (outcome === "disabled") return fail("account_disabled");
      res.clearCookie(GATE_FLOW_COOKIE, cookieOpts);
      res.clearCookie(GATE_TAB_COOKIE, cookieOpts);
      back(res, outcome === "ok" ? "gate=ok" : "gate=link", tab);
    } catch (e) {
      next(e);
    }
  });

  // --- pending identity: link to an existing account or create one ---

  async function pendingOf(
    req: express.Request,
  ): Promise<{ hash: string; p: GatePendingRow } | null> {
    const raw = d.readCookie(req, GATE_PENDING_COOKIE);
    if (!raw || raw.length > 200) return null;
    const hash = sha256Hex(raw);
    const p = await store.findGatePending(hash);
    return p ? { hash, p } : null;
  }
  const noPending = (res: express.Response) =>
    void res.status(401).json({ error: "no_pending" });

  /** The unlinked, enabled account with the GATE email, if any. */
  async function matchOf(p: GatePendingRow) {
    if (!p.email) return null;
    const u = await store.findUserByEmail(p.email);
    return u && !u.gate_sub && !u.disabled_at ? u : null;
  }

  /** Signs the player in after a successful link or create, and spends the pending. */
  async function finish(
    req: express.Request,
    res: express.Response,
    hash: string,
    userId: string,
  ) {
    await store.deleteGatePending(hash);
    res.clearCookie(GATE_PENDING_COOKIE, cookieOpts);
    await d.startSession(res, userId, req.headers["user-agent"]);
  }

  /** New accounts need an email and GATE's explicit `email_approved: true`. */
  function mayCreate(p: GatePendingRow): boolean {
    return (
      p.email !== null && p.email.length <= 254 && p.emailApproved === true
    );
  }

  app.get("/auth/gate/pending", async (req, res, next) => {
    try {
      const pend = await pendingOf(req);
      if (!pend) return noPending(res);
      const { p } = pend;
      const match = await matchOf(p);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        loginName: p.loginName,
        displayName: p.displayName,
        email: p.email,
        match: match ? { username: match.username } : null,
        canCreate: mayCreate(p),
        usernameTaken: (await store.findUserByUsername(p.loginName)) !== null,
      });
    } catch (e) {
      next(e);
    }
  });

  app.post("/auth/gate/link/confirm", json, async (req, res, next) => {
    try {
      const pend = await pendingOf(req);
      if (!pend) return noPending(res);
      const match = await matchOf(pend.p);
      if (!match) return void res.status(409).json({ error: "no_match" });
      const r = await store.linkGate(
        match.id,
        pend.p.gateSub,
        pend.p.email,
        pend.p.idToken,
      );
      if (r === "already_linked") {
        return void res.status(409).json({ error: "already_linked" });
      }
      if (r === "gone") return void res.status(409).json({ error: "no_match" });
      await finish(req, res, pend.hash, match.id);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  app.post("/auth/gate/link/password", json, async (req, res, next) => {
    try {
      const pend = await pendingOf(req);
      if (!pend) return noPending(res);
      const body = bodyOf(req);
      const login = str(body.username)?.trim() ?? "";
      const password = str(body.password) ?? "";
      const acctKey = login.toLowerCase();
      // The same limits as password sign-in: this is a password guess too.
      if (
        !d.limits.loginIp.hit(ipOf(req)) ||
        d.limits.loginAccount.blocked(acctKey)
      ) {
        return void res.status(429).json({ error: "rate_limited" });
      }
      const invalid = () => {
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
        return invalid();
      }
      const cred = await store.findCredentials(login);
      const ok = await verifyPassword(cred?.passwordHash ?? null, password);
      if (!cred || !ok || cred.user.disabled_at) return invalid();
      if (cred.user.gate_sub) {
        return void res.status(409).json({ error: "already_linked" });
      }
      const r = await store.linkGate(
        cred.user.id,
        pend.p.gateSub,
        pend.p.email,
        pend.p.idToken,
      );
      if (r === "already_linked") {
        return void res.status(409).json({ error: "already_linked" });
      }
      if (r === "gone") return invalid();
      d.limits.loginAccount.reset(acctKey);
      await finish(req, res, pend.hash, cred.user.id);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  app.post("/auth/gate/create", json, async (req, res, next) => {
    try {
      const pend = await pendingOf(req);
      if (!pend) return noPending(res);
      if (!d.limits.registerIp.hit(ipOf(req))) {
        return void res.status(429).json({ error: "rate_limited" });
      }
      const { p } = pend;
      // GATE requires players to be 13 or older when they sign up there, so
      // the age confirmation HT asks for at registration is covered.
      // The approval comes from the verified id_token/userinfo stored with the
      // pending, never from the request. Missing or false fails closed.
      if (!p.email || !mayCreate(p)) {
        return void res.status(403).json({ error: "email_not_approved" });
      }
      const username = str(bodyOf(req).username)?.trim() ?? "";
      if (
        username.length < 3 ||
        username.length > 20 ||
        !USERNAME_RE.test(username)
      ) {
        return void res.status(400).json({ error: "username_invalid" });
      }
      if (profanityMatcher.hasMatch(username)) {
        return void res.status(400).json({ error: "username_censored" });
      }
      const created = await store.createGateUser({
        publicId: generatePublicId(),
        username,
        email: p.email,
        gateSub: p.gateSub,
        idToken: p.idToken,
      });
      if (!created.ok) {
        if (created.taken === "gate") {
          return void res.status(409).json({ error: "already_linked" });
        }
        return void res.status(409).json({
          error: created.taken === "email" ? "email_taken" : "username_taken",
        });
      }
      await finish(req, res, pend.hash, created.user.id);
      res
        .status(201)
        .json({ ok: true, userId: uuidToBase64url(created.user.id) });
    } catch (e) {
      next(e);
    }
  });

  // --- direct sign-in ("Redirect failed? Sign in here") ---
  // The browser posts the player's details to HT; HT calls GATE's
  // /oidc/direct/* server to server. The password is forwarded and never kept.

  // Players share school IPs: only a flood backstop, no tight per-IP limit.
  const directFlood = new RateLimiter(600, 60_000);
  const htError = (
    res: express.Response,
    status: number,
    code: string,
    message: string,
  ) => void res.status(status).json({ error: { code, message } });

  type Spec = Record<string, number | "bool">;
  const SPECS: Record<string, Spec> = {
    login: { identifier: 254, password: 1024 },
    verify: { pending: 200, code: 12 },
    resend: { pending: 200 },
    recover: { identifier: 254 },
    reset: { pending: 200, code: 12, newPassword: 1024 },
    signup: {
      firstName: 100,
      lastName: 100,
      loginName: 100,
      displayName: 100,
      email: 254,
      password: 1024,
      ageConfirmed13: "bool",
    },
  };
  const playerIp = (req: express.Request): string | undefined => {
    const ip = (req.ip ?? "").replace(/^::ffff:/, "");
    return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : undefined;
  };

  /** Passes GATE's answer on; only `error` and `pending` ever reach the browser. */
  function relay(res: express.Response, r: DirectResult): void {
    if (r.retryAfter) res.setHeader("Retry-After", r.retryAfter);
    const err = r.body?.error;
    const gateErr = err && typeof err === "object" ? err : null;
    if (r.status >= 500 || (r.status >= 400 && !gateErr)) {
      return htError(
        res,
        503,
        "HT_UNAVAILABLE",
        "GLL ID isn't reachable right now. Try again in a bit.",
      );
    }
    res.setHeader("Cache-Control", "no-store");
    if (r.status >= 400) {
      const pending = r.body?.pending;
      return void res.status(r.status).json({
        error: gateErr,
        ...(typeof pending === "string" ? { pending } : {}),
      });
    }
    if (r.status === 204 || !r.body) return void res.status(r.status).end();
    const pending = r.body.pending;
    res.status(r.status).json(typeof pending === "string" ? { pending } : {});
  }

  /** login and verify: ask GATE for a code, then take the redirect callback's path. */
  async function codeFlow(
    req: express.Request,
    res: express.Response,
    r: DirectResult | null,
    verifier: string,
    nonce: string,
  ): Promise<void> {
    if (!r || r.status !== 200 || typeof r.body?.code !== "string") {
      return relay(res, r ?? { status: 503, body: null, retryAfter: null });
    }
    let who: GateIdentity;
    try {
      who = await gate.exchange({
        code: r.body.code,
        codeVerifier: verifier,
        nonce,
      });
    } catch (e) {
      if (!(e instanceof GateError)) throw e;
      if (e.code === "unavailable") {
        return htError(
          res,
          503,
          "HT_UNAVAILABLE",
          "GLL ID isn't reachable right now. Try again in a bit.",
        );
      }
      return htError(
        res,
        e.code === "expired" ? 400 : 502,
        e.code === "expired" ? "HT_EXPIRED" : "HT_INVALID",
        e.code === "expired"
          ? "That sign-in took too long. Please try again."
          : "GLL ID sign-in didn't check out. Please try again.",
      );
    }
    const outcome = await signInWho(req, res, who);
    if (outcome === "disabled") {
      return htError(
        res,
        403,
        "HT_ACCOUNT_DISABLED",
        "This GLL ID account is disabled. Ask an admin for help.",
      );
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({ status: outcome });
  }

  for (const op of Object.keys(SPECS)) {
    app.post(`/auth/gate/direct/${op}`, json, async (req, res, next) => {
      try {
        if (!gate.enabled) {
          return htError(
            res,
            403,
            "HT_DISABLED",
            "GLL ID sign-in isn't turned on right now.",
          );
        }
        if (!directFlood.hit(ipOf(req))) {
          return htError(
            res,
            429,
            "HT_RATE_LIMITED",
            "Too many tries. Wait a few minutes and try again.",
          );
        }
        const body = bodyOf(req);
        const out: Record<string, unknown> = {};
        for (const [k, max] of Object.entries(SPECS[op])) {
          const v = body[k];
          const ok =
            max === "bool"
              ? typeof v === "boolean"
              : typeof v === "string" && v !== "" && v.length <= max;
          if (!ok) {
            return htError(
              res,
              400,
              "HT_INVALID_REQUEST",
              "Fill in every field and try again.",
            );
          }
          out[k] = v;
        }
        const ip = playerIp(req);
        if (ip) out.player_ip = ip;
        try {
          if (op === "signup") {
            const legal = await gate.legalVersions();
            if (!legal) throw new GateError("unavailable");
            out.tosVersion = legal.tos;
            out.privacyVersion = legal.privacy;
          }
          if (op === "login" || op === "verify") {
            const verifier = randomToken();
            const nonce = randomToken();
            const r = await gate.direct(op, {
              ...out,
              redirect_uri: env.gateRedirectUri,
              code_challenge: pkceChallenge(verifier),
              nonce,
              scope: "openid profile email",
            });
            return await codeFlow(req, res, r, verifier, nonce);
          }
          relay(res, await gate.direct(op, out));
        } catch (e) {
          if (!(e instanceof GateError)) throw e;
          htError(
            res,
            503,
            "HT_UNAVAILABLE",
            "GLL ID isn't reachable right now. Try again in a bit.",
          );
        }
      } catch (e) {
        next(e);
      }
    });
  }
}
