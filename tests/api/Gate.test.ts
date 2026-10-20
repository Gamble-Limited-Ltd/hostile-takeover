// @vitest-environment node
import type { AddressInfo } from "net";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, test } from "vitest";
import {
  createApp,
  REFRESH_COOKIE,
  type AppContext,
} from "../../packages/api/src/app";
import { readEnv } from "../../packages/api/src/env";
import {
  generatePrivateKeyPem,
  keysFromPem,
} from "../../packages/api/src/keys";
import { hashPassword } from "../../packages/api/src/passwords";
import { generatePublicId } from "../../packages/api/src/publicId";
import {
  defaultRateLimits,
  RateLimiter,
} from "../../packages/api/src/rateLimit";
import type { UserRow } from "../../packages/api/src/userMe";
import {
  FAKE_CLIENT_ID,
  FAKE_CLIENT_SECRET,
  startFakeGate,
  type MintOptions,
} from "./fakeGate";
import { memoryStore } from "./memoryStore";

const GAME = "http://localhost:5178";
const API = "http://localhost:8787";
const PW = "correct horse battery";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function row(name: string, extra: Partial<UserRow> = {}): UserRow {
  return {
    id: randomUUID(),
    public_id: generatePublicId(),
    username: name,
    first_name: "F",
    last_name: "L",
    email: `${name}@kmlhs.org`,
    rank: "PLAYER",
    disabled_at: null,
    gate_sub: null,
    ...extra,
  };
}

interface Opts {
  env?: Record<string, string>;
  gateOpts?: Parameters<typeof startFakeGate>[0];
  limits?: ReturnType<typeof defaultRateLimits>;
  noGate?: boolean;
}

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

async function harness(o: Opts = {}) {
  const fake = await startFakeGate(o.gateOpts);
  cleanup.push(fake.close);
  const pw = await hashPassword(PW);
  const alice = row("alice"); // email alice@kmlhs.org: matches the fake's default email
  const bob = row("bob");
  const linked = row("linked", {
    gate_sub: "gate-sub-1",
    email: "old@kmlhs.org",
  });
  const gone = row("gone", {
    gate_sub: "gate-sub-gone",
    disabled_at: new Date(),
  });
  const goneUnlinked = row("goneunlinked", {
    email: "gu@kmlhs.org",
    disabled_at: new Date(),
  });
  const taken = row("gatealice", { email: "taken@kmlhs.org" });
  const mem = memoryStore([alice, bob, linked, gone, goneUnlinked, taken], {
    [alice.id]: pw,
    [bob.id]: pw,
    [linked.id]: pw,
    [gone.id]: pw,
    [goneUnlinked.id]: pw,
    [taken.id]: pw,
  });
  const env = readEnv({
    API_URL: API,
    DOMAIN: "localhost",
    GAME_ORIGIN: GAME,
    ...(o.noGate
      ? {}
      : {
          GATE_ISSUER: fake.issuer,
          GATE_CLIENT_ID: FAKE_CLIENT_ID,
          GATE_CLIENT_SECRET: FAKE_CLIENT_SECRET,
        }),
    ...o.env,
  });
  const limits = o.limits ?? defaultRateLimits();
  limits.loginIp = new RateLimiter(1000, 60_000);
  limits.registerIp = new RateLimiter(1000, 60_000);
  const ctx: AppContext = {
    env,
    keys: await keysFromPem(generatePrivateKeyPem()),
    store: mem.store,
    limits,
  };
  const server = createApp({ query: async () => ({}) }, ctx).listen(
    0,
    "127.0.0.1",
  );
  await new Promise((r) => server.once("listening", r));
  cleanup.push(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const cookieVal = (res: Response, name: string): string | null => {
    const raw = res.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${name}=`));
    const v = raw?.split(";")[0].slice(name.length + 1);
    return v ? decodeURIComponent(v) : null;
  };
  const rawCookie = (res: Response, name: string) =>
    res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));

  const get = (path: string, cookie?: string) =>
    fetch(base + path, {
      redirect: "manual",
      headers: cookie ? { cookie } : {},
    });
  const post = (path: string, body: unknown, cookie?: string) =>
    fetch(base + path, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });

  /** Starts a sign-in. */
  async function begin() {
    const r = await get("/auth/gate/start");
    const loc = new URL(r.headers.get("location")!);
    return {
      res: r,
      loc,
      flow: cookieVal(r, "ht_gate_flow")!,
      state: loc.searchParams.get("state")!,
    };
  }
  /** Runs start, then the callback, with overrides at each step. */
  async function login(
    o: {
      mint?: MintOptions;
      code?: string;
      state?: string;
      iss?: string | null;
      flow?: string | null;
      error?: string;
      prep?: (b: Awaited<ReturnType<typeof begin>>) => void;
    } = {},
  ) {
    const b = await begin();
    o.prep?.(b);
    const code = o.code ?? (await fake.mint(b.loc.toString(), o.mint));
    const q = new URLSearchParams();
    if (o.error) q.set("error", o.error);
    else q.set("code", code);
    q.set("state", o.state ?? b.state);
    if (o.iss !== null) q.set("iss", o.iss ?? fake.issuer);
    const flow = o.flow === undefined ? b.flow : o.flow;
    const res = await get(
      `/auth/gate/callback?${q}`,
      flow ? `ht_gate_flow=${flow}` : undefined,
    );
    return {
      res,
      b,
      where: res.headers.get("location"),
      pending: cookieVal(res, "ht_gate_pending"),
      refresh: cookieVal(res, REFRESH_COOKIE),
    };
  }
  const pendingFor = async (o: Parameters<typeof login>[0] = {}) => {
    const r = await login(o);
    expect(r.where).toBe(`${GAME}/#gate=link`);
    return `ht_gate_pending=${r.pending}`;
  };

  return {
    fake,
    mem,
    env,
    ctx,
    base,
    get,
    post,
    begin,
    login,
    pendingFor,
    cookieVal,
    rawCookie,
    alice,
    bob,
    linked,
    gone,
    goneUnlinked,
    taken,
  };
}
type H = Awaited<ReturnType<typeof harness>>;
const err = (code: string) => `${GAME}/#gate_error=${code}`;

describe("config", () => {
  test("GET /auth/config reflects GATE and LEGACY_LOGIN", async () => {
    const h = await harness();
    expect(await (await h.get("/auth/config")).json()).toEqual({
      gate: true,
      legacy: true,
      gateUrl: h.fake.issuer,
    });
    const off = await harness({ noGate: true, env: { LEGACY_LOGIN: "off" } });
    expect(await (await off.get("/auth/config")).json()).toEqual({
      gate: false,
      legacy: false,
      gateUrl: "",
    });
  });

  test("LEGACY_LOGIN=off blocks login and register", async () => {
    const h = await harness({ env: { LEGACY_LOGIN: "off" } });
    for (const p of ["/auth/login", "/auth/register"]) {
      const r = await h.post(p, { usernameOrEmail: "alice", password: PW });
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({ error: "legacy_login_disabled" });
    }
  });
});

describe("start", () => {
  test("redirects to the authorize endpoint with PKCE, state, nonce and sets the flow cookie", async () => {
    const h = await harness();
    const b = await h.begin();
    expect(b.res.status).toBe(302);
    expect(b.loc.origin + b.loc.pathname).toBe(`${h.fake.issuer}/oidc/auth`);
    const q = b.loc.searchParams;
    expect(q.get("response_type")).toBe("code");
    expect(q.get("client_id")).toBe(FAKE_CLIENT_ID);
    expect(q.get("redirect_uri")).toBe(`${API}/auth/gate/callback`);
    expect(q.get("scope")).toBe("openid profile email");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const raw = h.rawCookie(b.res, "ht_gate_flow")!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/Path=\/auth\/gate/);
    expect(raw).toMatch(/SameSite=Lax/i);
    // Stored server-side by hash only.
    expect(h.mem.flows).toHaveLength(1);
    expect(h.mem.flows[0].stateHash).toBe(sha(b.state));
    expect(h.mem.flows[0].bindingHash).toBe(sha(b.flow));
    expect(h.mem.flows[0].nonce).toBe(q.get("nonce"));
    // Two starts never share randomness.
    const b2 = await h.begin();
    expect(b2.state).not.toBe(b.state);
    expect(b2.flow).not.toBe(b.flow);
  });

  test("disabled -> #gate_error=disabled", async () => {
    const h = await harness({ noGate: true });
    const r = await h.get("/auth/gate/start");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(err("disabled"));
    const c = await h.get("/auth/gate/callback?code=x&state=y&iss=z");
    expect(c.headers.get("location")).toBe(err("disabled"));
  });

  test("discovery is cached; an issuer mismatch is refused", async () => {
    const h = await harness();
    await h.begin();
    await h.begin();
    expect(h.fake.state.discoveryHits).toBe(1);
    const bad = await harness();
    bad.fake.state.discoveryIssuer = "https://evil.example";
    const r = await bad.get("/auth/gate/start");
    expect(r.headers.get("location")).toBe(err("unavailable"));
  });

  test("an unreachable provider -> unavailable", async () => {
    const h = await harness({ env: { GATE_ISSUER: "http://127.0.0.1:1" } });
    const r = await h.get("/auth/gate/start");
    expect(r.headers.get("location")).toBe(err("unavailable"));
  });

  test("GATE_BACKCHANNEL_URL is used for server fetches, not for the browser redirect", async () => {
    const h = await harness({
      gateOpts: { publicIssuer: "http://gate.test" },
      env: { GATE_ISSUER: "http://gate.test" },
    });
    h.ctx.env.gateBackchannelUrl = h.fake.origin;
    const r = await h.login({ mint: { claims: { sub: "fresh" } } });
    expect(r.b.loc.origin).toBe("http://gate.test");
    expect(r.where).toBe(`${GAME}/#gate=link`);
    expect(h.fake.state.tokenRequests).toHaveLength(1);
    expect(h.fake.state.jwksHits).toBe(1);
  });
});

describe("callback failures", () => {
  const cleared = (h: H, res: Response) => {
    const raw = h.rawCookie(res, "ht_gate_flow")!;
    expect(raw).toMatch(/^ht_gate_flow=;/);
  };

  test("no cookie -> invalid, and the flow cookie is cleared", async () => {
    const h = await harness();
    const r = await h.login({ flow: null });
    expect(r.where).toBe(err("invalid"));
    cleared(h, r.res);
  });

  test("a different browser's cookie does not consume the flow", async () => {
    const h = await harness();
    const r = await h.login({ flow: "somebody-elses-binding" });
    expect(r.where).toBe(err("expired"));
    expect(h.mem.flows[0].usedAt).toBeNull();
    cleared(h, r.res);
  });

  test("unknown state -> expired", async () => {
    const h = await harness();
    const r = await h.login({ state: "nope" });
    expect(r.where).toBe(err("expired"));
  });

  test("a replayed callback fails", async () => {
    const h = await harness();
    const first = await h.login({ mint: { claims: { sub: "fresh" } } });
    expect(first.where).toBe(`${GAME}/#gate=link`);
    const q = new URLSearchParams({
      code: "x",
      state: first.b.state,
      iss: h.fake.issuer,
    });
    const again = await h.get(
      `/auth/gate/callback?${q}`,
      `ht_gate_flow=${first.b.flow}`,
    );
    expect(again.headers.get("location")).toBe(err("expired"));
  });

  test("an expired flow fails", async () => {
    const h = await harness();
    const r = await h.login({
      prep: () => {
        h.mem.flows[0].expiresAt = new Date(Date.now() - 1000);
      },
    });
    expect(r.where).toBe(err("expired"));
  });

  test("wrong or missing iss parameter -> invalid", async () => {
    const h = await harness();
    expect((await h.login({ iss: "https://evil.example" })).where).toBe(
      err("invalid"),
    );
    expect((await h.login({ iss: null })).where).toBe(err("invalid"));
    expect(h.fake.state.tokenRequests).toHaveLength(0);
  });

  test("error=access_denied -> denied, no token request", async () => {
    const h = await harness();
    const r = await h.login({ error: "access_denied" });
    expect(r.where).toBe(err("denied"));
    cleared(h, r.res);
    expect(h.fake.state.tokenRequests).toHaveLength(0);
  });

  test("a replayed authorization code (invalid_grant) -> expired", async () => {
    const h = await harness();
    const b = await h.begin();
    const code = await h.fake.mint(b.loc.toString(), {
      claims: { sub: "fresh" },
    });
    const cb = (state: string, flow: string) =>
      h.get(
        `/auth/gate/callback?${new URLSearchParams({ code, state, iss: h.fake.issuer })}`,
        `ht_gate_flow=${flow}`,
      );
    expect((await cb(b.state, b.flow)).headers.get("location")).toBe(
      `${GAME}/#gate=link`,
    );
    const b2 = await h.begin();
    expect((await cb(b2.state, b2.flow)).headers.get("location")).toBe(
      err("expired"),
    );
  });

  test("token endpoint 5xx -> unavailable; other 4xx -> invalid", async () => {
    const h = await harness();
    h.fake.state.tokenOverride = { status: 503, body: {} };
    expect((await h.login()).where).toBe(err("unavailable"));
    h.fake.state.tokenOverride = {
      status: 401,
      body: { error: "invalid_client" },
    };
    expect((await h.login()).where).toBe(err("invalid"));
  });

  test("the token request uses client_secret_basic with form-encoded credentials, PKCE and the redirect uri", async () => {
    const h = await harness();
    await h.login();
    const t = h.fake.state.tokenRequests[0];
    const form = (v: string) =>
      new URLSearchParams({ x: v }).toString().slice(2);
    const basic = `${form(FAKE_CLIENT_ID)}:${form(FAKE_CLIENT_SECRET)}`;
    expect(t.authorization).toBe(
      `Basic ${Buffer.from(basic).toString("base64")}`,
    );
    expect(t.body.grant_type).toBe("authorization_code");
    expect(t.body.redirect_uri).toBe(`${API}/auth/gate/callback`);
    expect(t.body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(t.body.client_secret).toBeUndefined();
  });

  const bad: [string, MintOptions][] = [
    ["wrong iss", { claims: { iss: "https://evil.example" } }],
    ["wrong aud", { claims: { aud: "someone-else" } }],
    ["wrong nonce", { claims: { nonce: "not-mine" } }],
    ["missing nonce", { claims: { nonce: undefined } }],
    ["expired", { expiresIn: -120 }],
    ["HS256", { alg: "HS256" }],
    ["alg none", { alg: "none" }],
    ["unknown kid", { kid: "other" }],
    ["signed by another key", { signWith: undefined, claims: {} }],
    ["azp mismatch", { claims: { azp: "other-client" } }],
    ["email_verified false", { claims: { email_verified: false } }],
    ["email_verified missing", { claims: { email_verified: undefined } }],
    ["empty sub", { claims: { sub: "" } }],
    ["missing sub", { claims: { sub: undefined } }],
  ];
  test.each(bad)(
    "bad id_token (%s) -> invalid, nothing created",
    async (name, mint) => {
      const h = await harness();
      if (name === "signed by another key")
        mint = { signWith: await h.fake.otherKey() };
      const r = await h.login({ mint });
      expect(r.where).toBe(err("invalid"));
      expect(r.refresh).toBeNull();
      expect(r.pending).toBeNull();
      expect(h.mem.pending).toHaveLength(0);
      expect(h.mem.sessions).toHaveLength(0);
    },
  );

  test("no azp claim is accepted", async () => {
    const h = await harness();
    expect(
      (await h.login({ mint: { claims: { azp: undefined, sub: "fresh" } } }))
        .where,
    ).toBe(`${GAME}/#gate=link`);
  });
});

describe("callback success", () => {
  test("a linked user gets a session and #gate=ok; a changed email follows GATE", async () => {
    const h = await harness();
    const r = await h.login();
    expect(r.where).toBe(`${GAME}/#gate=ok`);
    expect(r.refresh).toBeTruthy();
    expect(h.mem.sessions).toHaveLength(1);
    expect(h.mem.sessions[0].user_id).toBe(h.linked.id);
    expect(h.rawCookie(r.res, "ht_gate_flow")).toMatch(/^ht_gate_flow=;/);
    // The refresh cookie then works against /auth/refresh.
    const rr = await h.post(
      "/auth/refresh",
      undefined,
      `${REFRESH_COOKIE}=${r.refresh}`,
    );
    expect(rr.status).toBe(200);
  });

  test("the linked user's email is not overwritten when another account holds it", async () => {
    const h = await harness({});
    // alice@kmlhs.org belongs to the unlinked "alice" account.
    const r = await h.login();
    expect(r.where).toBe(`${GAME}/#gate=ok`);
    expect(h.linked.email).toBe("old@kmlhs.org");
    expect(h.alice.email).toBe("alice@kmlhs.org");
  });

  test("a linked user's email is updated to GATE's when free", async () => {
    const h = await harness();
    const r = await h.login({ mint: { claims: { email: "fresh@kmlhs.org" } } });
    expect(r.where).toBe(`${GAME}/#gate=ok`);
    expect(h.linked.email).toBe("fresh@kmlhs.org");
  });

  test("a linked but disabled user -> account_disabled, no session", async () => {
    const h = await harness();
    const r = await h.login({ mint: { claims: { sub: "gate-sub-gone" } } });
    expect(r.where).toBe(err("account_disabled"));
    expect(r.refresh).toBeNull();
    expect(h.mem.sessions).toHaveLength(0);
  });

  test("an unknown subject gets a pending cookie, no session", async () => {
    const h = await harness();
    const r = await h.login({ mint: { claims: { sub: "brand-new" } } });
    expect(r.where).toBe(`${GAME}/#gate=link`);
    expect(r.refresh).toBeNull();
    const raw = h.rawCookie(r.res, "ht_gate_pending")!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/Path=\/auth\/gate/);
    expect(h.mem.pending).toHaveLength(1);
    expect(h.mem.pending[0].tokenHash).toBe(sha(r.pending!));
    expect(h.mem.sessions).toHaveLength(0);
  });
});

describe("first-time players", () => {
  test("a free login name becomes the account: session, no pending", async () => {
    const h = await harness();
    const r = await h.login({
      mint: {
        claims: { sub: "s-new", login_name: "freshkid", email: "n@kmlhs.org" },
      },
    });
    expect(r.where).toBe(`${GAME}/#gate=ok`);
    expect(r.refresh).toBeTruthy();
    expect(r.pending).toBeNull();
    expect(h.mem.pending).toHaveLength(0);
    expect(h.mem.users.find((x) => x.username === "freshkid")).toMatchObject({
      email: "n@kmlhs.org",
      gate_sub: "s-new",
    });
  });

  test("an approved non-kmlhs email creates too", async () => {
    const h = await harness();
    const r = await h.login({
      mint: {
        claims: { sub: "s-ext", login_name: "outsider", email: "f@gmail.com" },
      },
    });
    expect(r.where).toBe(`${GAME}/#gate=ok`);
    expect(h.mem.users.some((x) => x.username === "outsider")).toBe(true);
  });

  test("an email that matches an old account goes to the link card, not a new account", async () => {
    const h = await harness();
    const r = await h.login({
      mint: { claims: { sub: "s-m", login_name: "freshkid" } },
    });
    expect(r.where).toBe(`${GAME}/#gate=link`);
    expect(r.pending).toBeTruthy();
    expect(h.mem.users.some((x) => x.username === "freshkid")).toBe(false);
  });

  test("a taken, censored or invalid login name waits for a rename", async () => {
    const h = await harness();
    for (const login of ["gatealice", "fuck", "bad!name"]) {
      const r = await h.login({
        mint: {
          claims: {
            sub: `s-${login}`,
            login_name: login,
            email: "n@kmlhs.org",
          },
        },
      });
      expect(r.where).toBe(`${GAME}/#gate=link`);
      expect(r.refresh).toBeNull();
      expect(r.pending).toBeTruthy();
    }
    expect(h.mem.users.some((x) => x.gate_sub?.startsWith("s-"))).toBe(false);
  });

  test("losing the race for the name falls back to a rename", async () => {
    const h = await harness();
    h.mem.store.createGateUser = async () => ({ ok: false, taken: "username" });
    const r = await h.login({
      mint: {
        claims: { sub: "s-r", login_name: "freshkid", email: "n@kmlhs.org" },
      },
    });
    expect(r.where).toBe(`${GAME}/#gate=link`);
    expect(r.pending).toBeTruthy();
  });

  test("an email GATE hasn't approved is refused up front, with nothing stored", async () => {
    const h = await harness();
    for (const approved of [false, undefined, "true", 1, null]) {
      const r = await h.login({
        mint: {
          claims: {
            sub: `s-${String(approved)}`,
            login_name: "freshkid",
            email: "kid@kmlhs.org",
            email_approved: approved,
          },
        },
      });
      expect(r.where).toBe(err("email_not_approved"));
      expect(r.pending).toBeNull();
      expect(r.refresh).toBeNull();
    }
    const none = await h.login({
      mint: { claims: { sub: "s-none", email: undefined } },
    });
    expect(none.where).toBe(err("email_not_approved"));
    expect(h.mem.pending).toHaveLength(0);
    expect(h.mem.users.some((u) => u.username === "freshkid")).toBe(false);
  });

  test("an old account can still be linked when GATE hasn't approved the email", async () => {
    const h = await harness();
    const r = await h.login({
      mint: { claims: { sub: "s-old", email_approved: false } },
    });
    expect(r.where).toBe(`${GAME}/#gate=link`);
  });
});

describe("pending", () => {
  test("401 without a cookie or with a bogus one", async () => {
    const h = await harness();
    for (const c of [undefined, "ht_gate_pending=bogus"]) {
      const r = await h.get("/auth/gate/pending", c);
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: "no_pending" });
    }
  });

  test("reports a matching unlinked account", async () => {
    const h = await harness();
    const c = await h.pendingFor({
      mint: {
        claims: {
          sub: "s-new",
          login_name: "freshname",
          email: "BOB@kmlhs.org",
        },
      },
    });
    expect(await (await h.get("/auth/gate/pending", c)).json()).toEqual({
      loginName: "freshname",
      email: "BOB@kmlhs.org",
      match: { username: "bob" },
      suggestion: null,
    });
  });

  test("no match when the account is disabled; a taken name gets a suggestion", async () => {
    const h = await harness();
    const c = await h.pendingFor({
      mint: {
        claims: { sub: "s1", email: "gu@kmlhs.org", login_name: "GateAlice" },
      },
    });
    expect(await (await h.get("/auth/gate/pending", c)).json()).toMatchObject({
      match: null,
      suggestion: "GateAlice_2",
    });
  });

  test("the suggestion skips taken, censored and invalid names, and is null when none fit", async () => {
    const suggestion = async (login: string, taken: string[] = []) => {
      const h = await harness();
      for (const t of taken) h.mem.users.push(row(t));
      const c = await h.pendingFor({
        mint: {
          claims: { sub: "s1", email: "n@kmlhs.org", login_name: login },
        },
      });
      return (await (await h.get("/auth/gate/pending", c)).json()).suggestion;
    };
    expect(await suggestion("gatealice", ["gatealice_2"])).toBe("gatealice_3");
    expect(await suggestion("a".repeat(25))).toBe(`${"a".repeat(18)}_2`);
    expect(await suggestion("fuck")).toBeNull();
    expect(await suggestion("bad!name")).toBeNull();
    const all = [2, 3, 4, 5, 6, 7, 8, 9].map((n) => `gatealice_${n}`);
    expect(await suggestion("gatealice", all)).toBeNull();
  });

  test("an expired pending is gone", async () => {
    const h = await harness();
    const c = await h.pendingFor({ mint: { claims: { sub: "s1" } } });
    h.mem.pending[0].expiresAt = new Date(Date.now() - 1);
    expect((await h.get("/auth/gate/pending", c)).status).toBe(401);
  });
});

describe("link/confirm", () => {
  test("links the matching account, starts a session and consumes the pending", async () => {
    const h = await harness();
    const c = await h.pendingFor({
      mint: { claims: { sub: "s-bob", email: "bob@kmlhs.org" } },
    });
    const r = await h.post("/auth/gate/link/confirm", {}, c);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(h.cookieVal(r, REFRESH_COOKIE)).toBeTruthy();
    expect(h.bob.gate_sub).toBe("s-bob");
    expect(h.mem.pending).toHaveLength(0);
    expect(h.rawCookie(r, "ht_gate_pending")).toMatch(/^ht_gate_pending=;/);
    // Single use.
    expect((await h.post("/auth/gate/link/confirm", {}, c)).status).toBe(401);
    // Next time the sign-in is direct.
    const again = await h.login({
      mint: { claims: { sub: "s-bob", email: "bob@kmlhs.org" } },
    });
    expect(again.where).toBe(`${GAME}/#gate=ok`);
  });

  test("linking an old account needs no email_approved: absent or false still links", async () => {
    for (const approved of [false, undefined]) {
      const h = await harness();
      const c = await h.pendingFor({
        mint: {
          claims: {
            sub: "s-bob",
            email: "bob@kmlhs.org",
            email_approved: approved,
          },
        },
      });
      const r = await h.post("/auth/gate/link/confirm", {}, c);
      expect(r.status).toBe(200);
      expect(h.bob.gate_sub).toBe("s-bob");
    }
  });

  test("401 without a pending; 409 no_match when nothing matches", async () => {
    const h = await harness();
    expect((await h.post("/auth/gate/link/confirm", {})).status).toBe(401);
    const c = await h.pendingFor({
      mint: { claims: { sub: "s1", email: "nobody@kmlhs.org" } },
    });
    const r = await h.post("/auth/gate/link/confirm", {}, c);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "no_match" });
    expect(h.mem.sessions).toHaveLength(0);
  });

  test("no_match for a disabled account", async () => {
    const h = await harness();
    const c = await h.pendingFor({
      mint: { claims: { sub: "s1", email: "gu@kmlhs.org" } },
    });
    expect((await h.post("/auth/gate/link/confirm", {}, c)).status).toBe(409);
    expect(h.goneUnlinked.gate_sub).toBeNull();
  });

  test("already_linked when the subject got linked to another account meanwhile", async () => {
    const h = await harness();
    const c = await h.pendingFor({
      mint: { claims: { sub: "s-bob2", email: "bob@kmlhs.org" } },
    });
    h.alice.gate_sub = "s-bob2"; // linked elsewhere between pending and confirm
    const r = await h.post("/auth/gate/link/confirm", {}, c);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("already_linked");
    expect(h.bob.gate_sub).toBeNull();
  });

  test("no_match when the match got linked meanwhile", async () => {
    const h = await harness();
    const c = await h.pendingFor({
      mint: { claims: { sub: "s-bob", email: "bob@kmlhs.org" } },
    });
    h.bob.gate_sub = "someone-else";
    const r = await h.post("/auth/gate/link/confirm", {}, c);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("no_match");
  });
});

describe("link/password", () => {
  test("links the named account with the right password and sets GATE's email when free", async () => {
    const h = await harness();
    const c = await h.pendingFor({
      mint: { claims: { sub: "s-b", email: "bobby@kmlhs.org" } },
    });
    const r = await h.post(
      "/auth/gate/link/password",
      { username: "BOB", password: PW },
      c,
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(h.cookieVal(r, REFRESH_COOKIE)).toBeTruthy();
    expect(h.bob.gate_sub).toBe("s-b");
    expect(h.bob.email).toBe("bobby@kmlhs.org");
    expect(h.mem.pending).toHaveLength(0);
  });

  test("401 no_pending; wrong password and unknown user -> invalid_credentials and the pending survives", async () => {
    const h = await harness();
    expect(
      (
        await h.post("/auth/gate/link/password", {
          username: "bob",
          password: PW,
        })
      ).status,
    ).toBe(401);
    const c = await h.pendingFor({ mint: { claims: { sub: "s-b" } } });
    for (const body of [
      { username: "bob", password: "wrong wrong wrong" },
      { username: "nobody", password: PW },
      { username: "bob" },
      {},
    ]) {
      const r = await h.post("/auth/gate/link/password", body, c);
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: "invalid_credentials" });
    }
    expect(h.bob.gate_sub).toBeNull();
    expect(h.mem.pending).toHaveLength(1);
  });

  test("rate limited per account and per IP", async () => {
    const limits = defaultRateLimits();
    limits.loginAccount = new RateLimiter(2, 60_000);
    const h = await harness({ limits });
    const c = await h.pendingFor({ mint: { claims: { sub: "s-b" } } });
    const bad = { username: "bob", password: "wrong wrong wrong" };
    expect((await h.post("/auth/gate/link/password", bad, c)).status).toBe(401);
    expect((await h.post("/auth/gate/link/password", bad, c)).status).toBe(401);
    const blocked = await h.post(
      "/auth/gate/link/password",
      { username: "bob", password: PW },
      c,
    );
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
  });

  test("already_linked: target has a GATE link, or the subject is linked elsewhere", async () => {
    const h = await harness();
    const c = await h.pendingFor({ mint: { claims: { sub: "s-b" } } });
    const r = await h.post(
      "/auth/gate/link/password",
      { username: "linked", password: PW },
      c,
    );
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "already_linked" });
    // The subject got linked to another account after the pending was made.
    h.alice.gate_sub = "s-b";
    const r2 = await h.post(
      "/auth/gate/link/password",
      { username: "bob", password: PW },
      c,
    );
    expect(r2.status).toBe(409);
    expect((await r2.json()).error).toBe("already_linked");
    expect(h.bob.gate_sub).toBeNull();
  });

  test("a disabled target is treated as invalid credentials", async () => {
    const h = await harness();
    const c = await h.pendingFor({ mint: { claims: { sub: "s-b" } } });
    const r = await h.post(
      "/auth/gate/link/password",
      { username: "goneunlinked", password: PW },
      c,
    );
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "invalid_credentials" });
    expect(h.goneUnlinked.gate_sub).toBeNull();
  });

  test("works with LEGACY_LOGIN=off", async () => {
    const h = await harness({ env: { LEGACY_LOGIN: "off" } });
    const c = await h.pendingFor({ mint: { claims: { sub: "s-b" } } });
    const r = await h.post(
      "/auth/gate/link/password",
      { username: "bob", password: PW },
      c,
    );
    expect(r.status).toBe(200);
    expect(h.bob.gate_sub).toBe("s-b");
  });

  test("a GATE-created account has no password and cannot password-login", async () => {
    const h = await harness();
    const c = await h.pendingFor({
      mint: { claims: { sub: "s-new", email: "newbie@kmlhs.org" } },
    });
    expect(
      (await h.post("/auth/gate/create", { username: "Newbie" }, c)).status,
    ).toBe(201);
    const r = await h.post("/auth/login", {
      usernameOrEmail: "Newbie",
      password: PW,
    });
    expect(r.status).toBe(401);
  });
});

describe("create", () => {
  test("creates a password-less account with NULL names, links it, starts a session", async () => {
    const h = await harness();
    const c = await h.pendingFor({
      mint: { claims: { sub: "s-new", email: "newbie@kmlhs.org" } },
    });
    const r = await h.post("/auth/gate/create", { username: "New Kid" }, c);
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ ok: true });
    expect(h.cookieVal(r, REFRESH_COOKIE)).toBeTruthy();
    const u = h.mem.users.find((x) => x.username === "New Kid")!;
    expect(u).toMatchObject({
      first_name: null,
      last_name: null,
      email: "newbie@kmlhs.org",
      gate_sub: "s-new",
      rank: "PLAYER",
    });
    expect(h.mem.hashes[u.id]).toBeUndefined();
    expect(h.mem.pending).toHaveLength(0);
    // /users/@me works for it.
    const rr = await h.post(
      "/auth/refresh",
      undefined,
      `${REFRESH_COOKIE}=${h.cookieVal(r, REFRESH_COOKIE)}`,
    );
    const jwt = (await rr.json()).jwt as string;
    const meRes = await fetch(`${h.base}/users/@me`, {
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(meRes.status).toBe(200);
    expect((await meRes.json()).player.username).toBe("New Kid");
  });

  test("a kmlhs email with email_approved true creates", async () => {
    const h = await harness();
    const c = await h.pendingFor({
      mint: { claims: { sub: "s-k", email: "kid@kmlhs.org" } },
    });
    const r = await h.post("/auth/gate/create", { username: "Kmlhskid" }, c);
    expect(r.status).toBe(201);
  });

  test("create refuses a pending whose email isn't approved, whatever the body says", async () => {
    const h = await harness();
    h.mem.pending.push({
      tokenHash: sha("tok"),
      gateSub: "s-f",
      email: "f@gmail.com",
      loginName: "forger",
      emailApproved: false,
      idToken: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const r = await h.post(
      "/auth/gate/create",
      { username: "Forger", email_approved: true, emailApproved: true },
      "ht_gate_pending=tok",
    );
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "email_not_approved" });
    expect(h.mem.users.some((u) => u.username === "Forger")).toBe(false);
  });

  test("falls back to userinfo when the id_token has no email_approved", async () => {
    const h = await harness();
    h.fake.state.userinfo = { sub: "s-ui", email_approved: true };
    const r = await h.login({
      mint: {
        claims: {
          sub: "s-ui",
          login_name: "viauserinfo",
          email: "ui@gmail.com",
          email_approved: undefined,
        },
      },
    });
    expect(h.fake.state.userinfoRequests).toEqual(["Bearer at"]);
    expect(r.where).toBe(`${GAME}/#gate=ok`);
  });

  test("the id_token value wins over userinfo; no userinfo call is made", async () => {
    const h = await harness();
    h.fake.state.userinfo = { sub: "s-w", email_approved: true };
    const r = await h.login({
      mint: {
        claims: { sub: "s-w", email: "w@kmlhs.org", email_approved: false },
      },
    });
    expect(r.where).toBe(err("email_not_approved"));
    expect(h.fake.state.userinfoRequests).toEqual([]);
  });

  test("userinfo that is missing, failing or for another sub fails closed", async () => {
    for (const ui of [
      null,
      { sub: "someone-else", email_approved: true },
      { sub: "s-x", email_approved: "yes" },
    ]) {
      const h = await harness();
      h.fake.state.userinfo = ui;
      const r = await h.login({
        mint: {
          claims: {
            sub: "s-x",
            email: "x@kmlhs.org",
            email_approved: undefined,
          },
        },
      });
      expect(r.where).toBe(err("email_not_approved"));
    }
  });

  test("400 username_invalid / username_censored; 409 username_taken; 401 no_pending", async () => {
    const h = await harness();
    expect(
      (await h.post("/auth/gate/create", { username: "Okname" })).status,
    ).toBe(401);
    const c = await h.pendingFor({
      mint: { claims: { sub: "s-new", email: "newbie@kmlhs.org" } },
    });
    for (const u of ["ab", "x".repeat(21), "bad!name", "", undefined, 5]) {
      const r = await h.post("/auth/gate/create", { username: u }, c);
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe("username_invalid");
    }
    const cens = await h.post("/auth/gate/create", { username: "fuck" }, c);
    expect(cens.status).toBe(400);
    expect((await cens.json()).error).toBe("username_censored");
    const taken = await h.post("/auth/gate/create", { username: "ALICE" }, c);
    expect(taken.status).toBe(409);
    expect((await taken.json()).error).toBe("username_taken");
    expect(h.mem.pending).toHaveLength(1);
    expect(h.mem.users.some((u) => u.gate_sub === "s-new")).toBe(false);
  });

  test("409 email_taken if the address got an account meanwhile", async () => {
    const h = await harness();
    const c = await h.pendingFor({
      mint: { claims: { sub: "s-new", email: "late@kmlhs.org" } },
    });
    h.mem.users.push(row("late"));
    const r = await h.post("/auth/gate/create", { username: "Okname" }, c);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("email_taken");
  });
});

describe("logout", () => {
  test("gateLogoutUrl only for GATE-linked users while GATE is on", async () => {
    const h = await harness();
    const lin = await h.login();
    const out = await (
      await h.post("/auth/logout", {}, `${REFRESH_COOKIE}=${lin.refresh}`)
    ).json();
    expect(out.ok).toBe(true);
    const u = new URL(out.gateLogoutUrl);
    expect(u.origin + u.pathname).toBe(`${h.fake.issuer}/oidc/logout`);
    expect(u.searchParams.get("client_id")).toBe(FAKE_CLIENT_ID);
    expect(u.searchParams.get("post_logout_redirect_uri")).toBe(`${GAME}/`);
    expect(u.searchParams.get("id_token_hint")).toBe(h.fake.lastIdToken());

    // A password-only user gets none.
    const pw = await h.post("/auth/login", {
      usernameOrEmail: "bob",
      password: PW,
    });
    const o2 = await (
      await h.post(
        "/auth/logout",
        {},
        `${REFRESH_COOKIE}=${h.cookieVal(pw, REFRESH_COOKIE)}`,
      )
    ).json();
    expect(o2).toEqual({ ok: true });

    // GATE off: none even for a linked user.
    const off = await harness({ noGate: true });
    const pw2 = await off.post("/auth/login", {
      usernameOrEmail: "linked",
      password: PW,
    });
    const o3 = await (
      await off.post(
        "/auth/logout",
        {},
        `${REFRESH_COOKIE}=${off.cookieVal(pw2, REFRESH_COOKIE)}`,
      )
    ).json();
    expect(o3).toEqual({ ok: true });
  });

  test("uses discovery's end_session_endpoint, else {issuer}/oidc/logout", async () => {
    const h = await harness({
      gateOpts: { endSession: "http://elsewhere.test/bye" },
    });
    const lin = await h.login();
    const out = await (
      await h.post("/auth/logout", {}, `${REFRESH_COOKIE}=${lin.refresh}`)
    ).json();
    expect(new URL(out.gateLogoutUrl).origin).toBe("http://elsewhere.test");
    expect(new URL(out.gateLogoutUrl).searchParams.get("id_token_hint")).toBe(
      h.fake.lastIdToken(),
    );
    const h2 = await harness({ gateOpts: { endSession: false } });
    const lin2 = await h2.login();
    const out2 = await (
      await h2.post("/auth/logout", {}, `${REFRESH_COOKIE}=${lin2.refresh}`)
    ).json();
    expect(
      out2.gateLogoutUrl.startsWith(`${h2.fake.issuer}/oidc/logout?`),
    ).toBe(true);
    expect(new URL(out2.gateLogoutUrl).searchParams.get("id_token_hint")).toBe(
      h2.fake.lastIdToken(),
    );
  });

  test("the hint follows the latest sign-in, and a link or create stores the pending token", async () => {
    const h = await harness();
    await h.login();
    const second = await h.login();
    expect(h.fake.state.idTokens).toHaveLength(2);
    const out = await (
      await h.post("/auth/logout", {}, `${REFRESH_COOKIE}=${second.refresh}`)
    ).json();
    expect(new URL(out.gateLogoutUrl).searchParams.get("id_token_hint")).toBe(
      h.fake.state.idTokens[1],
    );

    const c = await h.pendingFor({
      mint: { claims: { sub: "s-new", email: "fresh@kmlhs.org" } },
    });
    const made = await h.post("/auth/gate/create", { username: "Okname" }, c);
    expect(made.status).toBe(201);
    const refresh = h.cookieVal(made, REFRESH_COOKIE);
    const out2 = await (
      await h.post("/auth/logout", {}, `${REFRESH_COOKIE}=${refresh}`)
    ).json();
    expect(new URL(out2.gateLogoutUrl).searchParams.get("id_token_hint")).toBe(
      h.fake.state.idTokens[2],
    );
  });

  test("the id_token is never returned from /users/@me", async () => {
    const h = await harness();
    const r = await h.login();
    const tok = h.fake.lastIdToken();
    const refreshed = await h.post(
      "/auth/refresh",
      undefined,
      `${REFRESH_COOKIE}=${r.refresh}`,
    );
    const jwt = ((await refreshed.json()) as { jwt?: string }).jwt ?? "";
    const me = await fetch(h.base + "/users/@me", {
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(me.status).toBe(200);
    expect(await me.text()).not.toContain(tok);
    const c = await h.pendingFor({ mint: { claims: { sub: "s-p" } } });
    const pend = await h.get("/auth/gate/pending", c);
    expect(await pend.text()).not.toContain(h.fake.lastIdToken());
  });
});

describe("migration 006_gate_pending_no_display_name.sql", () => {
  test("only relaxes gate_pending.display_name; drops nothing", async () => {
    const { dirSource } = await import("../../packages/api/src/migrate");
    const sql = await dirSource().read("006_gate_pending_no_display_name.sql");
    expect(sql).toMatch(
      /ALTER TABLE gate_pending ALTER COLUMN display_name DROP NOT NULL/,
    );
    expect(sql).not.toMatch(/DROP COLUMN|DROP TABLE/);
  });
});

describe("migration 005_gate_email_approved.sql", () => {
  test("adds a nullable email_approved column to gate_pending", async () => {
    const { dirSource } = await import("../../packages/api/src/migrate");
    const src = dirSource();
    expect(await src.list()).toContain("005_gate_email_approved.sql");
    const sql = await src.read("005_gate_email_approved.sql");
    expect(sql).toMatch(/ALTER TABLE gate_pending/);
    expect(sql).toMatch(/ADD COLUMN email_approved boolean\b(?!.*NOT NULL)/);
  });
});

describe("migration 004_gate.sql", () => {
  test("adds gate_sub, relaxes the name and password columns, creates the flow tables", async () => {
    const { dirSource } = await import("../../packages/api/src/migrate");
    const src = dirSource();
    expect(await src.list()).toContain("004_gate.sql");
    const sql = await src.read("004_gate.sql");
    expect(sql).toMatch(/ADD COLUMN gate_sub text UNIQUE/);
    for (const c of ["first_name", "last_name", "password_hash"]) {
      expect(sql).toMatch(new RegExp(`ALTER COLUMN ${c} DROP NOT NULL`));
    }
    expect(sql).toMatch(/CREATE TABLE gate_flows/);
    expect(sql).toMatch(/CREATE TABLE gate_pending/);
    expect(sql).toMatch(/ADD COLUMN gate_id_token text/);
    expect(sql).toMatch(/\bid_token text/);
    expect(sql).not.toMatch(/email[^,;]*DROP NOT NULL/);
  });
});
