// @vitest-environment node
// "Redirect failed? Sign in here": the /auth/gate/direct/* routes, which call
// GATE's /oidc/direct/* endpoints server to server (mocked by fakeGate).
import type { AddressInfo } from "net";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
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
import { generatePublicId } from "../../packages/api/src/publicId";
import { defaultRateLimits } from "../../packages/api/src/rateLimit";
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
const SECRET_PW = "Sup3r-secret-pw!";
const form = (x: string) => new URLSearchParams({ x }).toString().slice(2);
const basic = `Basic ${Buffer.from(
  `${form(FAKE_CLIENT_ID)}:${form(FAKE_CLIENT_SECRET)}`,
).toString("base64")}`;

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

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
  vi.restoreAllMocks();
});

async function harness(
  o: {
    env?: Record<string, string>;
    gateOpts?: Parameters<typeof startFakeGate>[0];
    users?: UserRow[];
  } = {},
) {
  const fake = await startFakeGate(o.gateOpts);
  cleanup.push(fake.close);
  const alice = row("alice"); // alice@kmlhs.org matches the fake's default email
  const linked = row("linked", { gate_sub: "gate-sub-1" });
  const mem = memoryStore(o.users ?? [alice, linked], {});
  const env = readEnv({
    API_URL: API,
    DOMAIN: "localhost",
    GAME_ORIGIN: GAME,
    GATE_ISSUER: fake.issuer,
    GATE_CLIENT_ID: FAKE_CLIENT_ID,
    GATE_CLIENT_SECRET: FAKE_CLIENT_SECRET,
    ...o.env,
  });
  const ctx: AppContext = {
    env,
    keys: await keysFromPem(generatePrivateKeyPem()),
    store: mem.store,
    limits: defaultRateLimits(),
  };
  const server = createApp({ query: async () => ({}) }, ctx).listen(
    0,
    "127.0.0.1",
  );
  await new Promise((r) => server.once("listening", r));
  cleanup.push(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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
  const cookieVal = (res: Response, name: string): string | null => {
    const raw = res.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${name}=`));
    const v = raw?.split(";")[0].slice(name.length + 1);
    return v ? decodeURIComponent(v) : null;
  };
  /** GATE's login/verify/reset in token mode: answers with an id_token. */
  const accept = (mint?: MintOptions) => async () => ({
    status: 200,
    json: { id_token: await fake.token(mint) },
  });
  return { fake, mem, env, ctx, base, post, cookieVal, accept, alice, linked };
}

const LOGIN = { identifier: "gatealice", password: SECRET_PW };

describe("forwarding", () => {
  test("every route calls GATE with Basic auth, player_ip and only the known fields", async () => {
    const h = await harness();
    const ok = { status: 204 };
    h.fake.state.direct.resend = () => ok;
    h.fake.state.direct.reset = () => ok;
    h.fake.state.direct.recover = () => ({
      status: 202,
      json: { pending: "p-rec" },
    });
    h.fake.state.direct.signup = () => ({
      status: 201,
      json: { pending: "p-new", account: { loginName: "n" } },
    });
    const body = { pending: "p1", code: "123456", newPassword: "Aa1!aaaa" };
    expect((await h.post("/auth/gate/direct/resend", body)).status).toBe(204);
    expect((await h.post("/auth/gate/direct/reset", body)).status).toBe(204);
    const rec = await h.post("/auth/gate/direct/recover", {
      identifier: "alice",
      junk: 1,
    });
    expect(rec.status).toBe(202);
    expect(await rec.json()).toEqual({ pending: "p-rec" });
    const su = await h.post("/auth/gate/direct/signup", {
      firstName: "A",
      lastName: "B",
      loginName: "ab",
      email: "ab@kmlhs.org",
      password: "Aa1!aaaa",
      ageConfirmed13: true,
      acceptedLegal: true,
      displayName: "AB",
      isAdmin: true,
    });
    expect(su.status).toBe(201);
    expect((await su.json()).pending).toBe("p-new");

    const reqs = h.fake.state.directRequests;
    expect(reqs.map((r) => r.op)).toEqual([
      "resend",
      "reset",
      "recover",
      "signup",
    ]);
    for (const r of reqs) {
      expect(r.authorization).toBe(basic);
      expect(r.body.player_ip).toMatch(/^(127\.0\.0\.1|::1)$/);
    }
    expect(reqs[2].body).toEqual({
      identifier: "alice",
      player_ip: reqs[2].body.player_ip,
    });
    // One consent from the browser covers both; HT adds nothing and fetches no versions.
    expect(reqs[3].body).toMatchObject({
      ageConfirmed13: true,
      acceptedLegal: true,
    });
    for (const k of [
      "isAdmin",
      "displayName",
      "tosVersion",
      "privacyVersion",
    ]) {
      expect(reqs[3].body).not.toHaveProperty(k);
    }
  });

  test("GATE's error body, status and Retry-After pass through", async () => {
    const h = await harness();
    h.fake.state.direct.login = () => ({
      status: 401,
      headers: { "retry-after": "30" },
      json: {
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Wrong login name or password.",
          fields: { password: "nope" },
        },
      },
    });
    const r = await h.post("/auth/gate/direct/login", LOGIN);
    expect(r.status).toBe(401);
    expect(r.headers.get("retry-after")).toBe("30");
    expect(await r.json()).toEqual({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Wrong login name or password.",
        fields: { password: "nope" },
      },
    });
  });

  test("DIRECT_SIGNIN_DISABLED reaches the browser with GATE's message", async () => {
    const h = await harness();
    const err = {
      error: { code: "DIRECT_SIGNIN_DISABLED", message: "Turned off." },
    };
    h.fake.state.direct.login = () => ({ status: 403, json: err });
    const r = await h.post("/auth/gate/direct/login", LOGIN);
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual(err);
  });

  test("an OAuth-shaped GATE error (bad client) is not shown as GATE's text", async () => {
    const h = await harness();
    h.fake.state.direct.login = () => ({
      status: 401,
      json: { error: "invalid_client" },
    });
    const r = await h.post("/auth/gate/direct/login", LOGIN);
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe("HT_UNAVAILABLE");
  });

  test("an unreachable GATE -> 503", async () => {
    const h = await harness({ env: { GATE_ISSUER: "http://127.0.0.1:1" } });
    const r = await h.post("/auth/gate/direct/login", LOGIN);
    expect(r.status).toBe(503);
  });

  test("bad input is refused before GATE is called", async () => {
    const h = await harness();
    for (const b of [
      {},
      { identifier: 1, password: "x" },
      { identifier: "a", password: "x".repeat(2000) },
    ]) {
      expect((await h.post("/auth/gate/direct/login", b)).status).toBe(400);
    }
    expect(h.fake.state.directRequests).toHaveLength(0);
  });

  test("GATE off -> 403 HT_DISABLED", async () => {
    const h = await harness({ env: { GATE_ISSUER: "" } });
    const r = await h.post("/auth/gate/direct/login", LOGIN);
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("HT_DISABLED");
  });

  test("a foreign Origin is refused like every other POST", async () => {
    const h = await harness();
    const res = await fetch(`${h.base}/auth/gate/direct/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil" },
      body: JSON.stringify(LOGIN),
    });
    expect(res.status).toBe(403);
    expect(h.fake.state.directRequests).toHaveLength(0);
  });

  test("the player's password is never logged", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (m) => vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const h = await harness();
    h.fake.state.direct.login = () => ({
      status: 401,
      json: { error: { code: "INVALID_CREDENTIALS", message: "no" } },
    });
    await h.post("/auth/gate/direct/login", LOGIN);
    h.fake.state.direct.login = () => {
      throw new Error("boom");
    };
    await h.post("/auth/gate/direct/login", LOGIN);
    for (const s of spies) {
      expect(JSON.stringify(s.mock.calls)).not.toContain(SECRET_PW);
    }
  });
});

describe("login -> code -> HT session", () => {
  test("a linked player gets a refresh cookie; token mode sends no PKCE, nonce or redirect_uri", async () => {
    const h = await harness();
    h.fake.state.direct.login = h.accept();
    const r = await h.post("/auth/gate/direct/login", LOGIN);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "ok" });
    expect(h.cookieVal(r, REFRESH_COOKIE)).toBeTruthy();
    const sent = h.fake.state.directRequests[0].body;
    expect(sent).toMatchObject({ identifier: "gatealice" });
    for (const k of ["redirect_uri", "code_challenge", "nonce", "scope"]) {
      expect(sent).not.toHaveProperty(k);
    }
    // Checked against GATE's keys; no code exchange.
    expect(h.fake.state.jwksHits).toBe(1);
    expect(h.fake.state.tokenRequests).toHaveLength(0);
  });

  test("an id_token signed with another key is refused, no session", async () => {
    const h = await harness();
    h.fake.state.direct.login = h.accept({ signWith: await h.fake.otherKey() });
    const r = await h.post("/auth/gate/direct/login", LOGIN);
    expect(r.status).toBe(502);
    expect(r.headers.getSetCookie().join()).not.toContain(REFRESH_COOKIE);
  });

  test("an email that matches an old account gets a pending cookie and status match", async () => {
    const h = await harness();
    h.fake.state.direct.login = h.accept({ claims: { sub: "fresh" } });
    const r = await h.post("/auth/gate/direct/login", LOGIN);
    expect(await r.json()).toEqual({ status: "match" });
    const pend = h.cookieVal(r, "ht_gate_pending");
    expect(pend).toBeTruthy();
    expect(h.cookieVal(r, REFRESH_COOKIE)).toBeNull();
    // The existing link step: the old account with the same email, password required.
    const c = `ht_gate_pending=${pend}`;
    const pe = await fetch(`${h.base}/auth/gate/pending`, {
      headers: { cookie: c },
    });
    expect((await pe.json()).match).toEqual({ username: "alice" });
    const no = await h.post("/auth/gate/link/confirm", {}, c);
    expect(no.status).toBe(403);
  });

  test("a new player with a free login name is signed in on the spot", async () => {
    const h = await harness({ users: [] });
    h.fake.state.direct.login = h.accept({ claims: { sub: "fresh" } });
    const r = await h.post("/auth/gate/direct/login", LOGIN);
    expect(await r.json()).toEqual({ status: "ok" });
    expect(h.cookieVal(r, REFRESH_COOKIE)).toBeTruthy();
    expect(h.mem.users[0]).toMatchObject({
      username: "gatealice",
      gate_sub: "fresh",
    });
  });

  test("a taken login name gets status rename and a suggestion", async () => {
    const h = await harness({ users: [row("gatealice")] });
    h.fake.state.direct.login = h.accept({ claims: { sub: "fresh" } });
    const r = await h.post("/auth/gate/direct/login", LOGIN);
    expect(await r.json()).toEqual({ status: "rename" });
    const c = `ht_gate_pending=${h.cookieVal(r, "ht_gate_pending")}`;
    const pe = await fetch(`${h.base}/auth/gate/pending`, {
      headers: { cookie: c },
    });
    expect(await pe.json()).toMatchObject({ suggestion: "gatealice_2" });
  });

  test("an email GATE hasn't approved gets 403 HT_EMAIL_NOT_APPROVED and nothing is stored", async () => {
    const h = await harness({ users: [] });
    h.fake.state.direct.login = h.accept({
      claims: { sub: "fresh", email_approved: false },
    });
    const r = await h.post("/auth/gate/direct/login", LOGIN);
    expect(r.status).toBe(403);
    expect((await r.json()).error).toEqual({
      code: "HT_EMAIL_NOT_APPROVED",
      message: "Sign up with your school email to play.",
    });
    expect(h.cookieVal(r, "ht_gate_pending")).toBeNull();
    expect(h.mem.pending).toHaveLength(0);
  });

  test("a disabled linked account is refused", async () => {
    const gone = row("gone", {
      gate_sub: "gate-sub-1",
      disabled_at: new Date(),
    });
    const h = await harness({ users: [gone] });
    h.fake.state.direct.login = h.accept();
    const r = await h.post("/auth/gate/direct/login", LOGIN);
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("HT_ACCOUNT_DISABLED");
  });
});

describe("verify, signup, recover", () => {
  test("EMAIL_UNVERIFIED pending is passed back, then verify signs in", async () => {
    const h = await harness();
    h.fake.state.direct.login = () => ({
      status: 403,
      json: {
        error: { code: "EMAIL_UNVERIFIED", message: "Check your email." },
        pending: "opaque-1",
      },
    });
    h.fake.state.direct.verify = h.accept();
    const r = await h.post("/auth/gate/direct/login", LOGIN);
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.pending).toBe("opaque-1");
    expect(body.error.code).toBe("EMAIL_UNVERIFIED");
    const v = await h.post("/auth/gate/direct/verify", {
      pending: body.pending,
      code: "123456",
    });
    expect(await v.json()).toEqual({ status: "ok" });
    expect(h.cookieVal(v, REFRESH_COOKIE)).toBeTruthy();
    const sent = h.fake.state.directRequests[1];
    expect(sent.op).toBe("verify");
    expect(sent.body).toMatchObject({ pending: "opaque-1", code: "123456" });
    expect(sent.body).not.toHaveProperty("code_challenge");
  });

  test("signup -> verify -> a new HT account is made with the login name", async () => {
    const h = await harness({ users: [] });
    h.fake.state.direct.verify = h.accept({
      claims: { sub: "new-1", email: "new@kmlhs.org", login_name: "Newbie" },
    });
    const v = await h.post("/auth/gate/direct/verify", {
      pending: "p",
      code: "123456",
    });
    expect(await v.json()).toEqual({ status: "ok" });
    expect(h.cookieVal(v, REFRESH_COOKIE)).toBeTruthy();
    expect(h.mem.users[0].username).toBe("Newbie");
  });

  test("reset signs the player in when GATE answers with an id_token", async () => {
    const h = await harness();
    h.fake.state.direct.reset = h.accept();
    const r = await h.post("/auth/gate/direct/reset", {
      pending: "p",
      code: "123456",
      newPassword: "Aa1!aaaa",
    });
    expect(await r.json()).toEqual({ status: "ok" });
    expect(h.cookieVal(r, REFRESH_COOKIE)).toBeTruthy();
    expect(h.fake.state.directRequests[0].body).not.toHaveProperty("nonce");
  });
});

describe("GATE_DIRECT_URL", () => {
  test("discovery, JWKS, token and direct calls go to it; iss stays the public issuer", async () => {
    const h = await harness({
      gateOpts: { publicIssuer: "http://gate.test" },
      env: { GATE_ISSUER: "http://gate.test" },
    });
    h.ctx.env.gateDirectUrl = h.fake.origin;
    h.fake.state.direct.login = h.accept();
    const r = await h.post("/auth/gate/direct/login", LOGIN);
    expect(await r.json()).toEqual({ status: "ok" });
    expect(h.fake.state.directRequests).toHaveLength(1);
    expect(h.fake.state.discoveryHits).toBe(1);
    expect(h.fake.state.jwksHits).toBe(1);
  });

  test("an id_token whose iss is not GATE_ISSUER is refused", async () => {
    const h = await harness({
      gateOpts: { publicIssuer: "http://gate.test" },
      env: { GATE_ISSUER: "http://gate.test" },
    });
    h.ctx.env.gateDirectUrl = h.fake.origin;
    h.fake.state.direct.login = h.accept({
      claims: { iss: h.fake.origin },
    });
    const r = await h.post("/auth/gate/direct/login", LOGIN);
    expect(r.status).toBe(502);
  });

  test("unset: the issuer itself is used", async () => {
    const h = await harness();
    expect(h.env.gateDirectUrl).toBe("");
    h.fake.state.direct.login = h.accept();
    expect((await h.post("/auth/gate/direct/login", LOGIN)).status).toBe(200);
  });
});

describe("new-tab flag", () => {
  test("start?tab=1 sets a cookie and the callback appends tab=1", async () => {
    const h = await harness();
    const s = await fetch(`${h.base}/auth/gate/start?tab=1`, {
      redirect: "manual",
    });
    const tab = h.cookieVal(s, "ht_gate_tab");
    expect(tab).toBe("1");
    const loc = new URL(s.headers.get("location")!);
    const code = await h.fake.mint(loc.toString(), {
      claims: { sub: "fresh-tab" },
    });
    const cb = await fetch(
      `${h.base}/auth/gate/callback?code=${code}&state=${loc.searchParams.get("state")}&iss=${encodeURIComponent(h.fake.issuer)}`,
      {
        redirect: "manual",
        headers: {
          cookie: `ht_gate_flow=${h.cookieVal(s, "ht_gate_flow")}; ht_gate_tab=1`,
        },
      },
    );
    expect(cb.headers.get("location")).toBe(`${GAME}/#gate=link&tab=1`);
  });

  test("without the flag the redirect is unchanged", async () => {
    const h = await harness();
    const s = await fetch(`${h.base}/auth/gate/start`, { redirect: "manual" });
    expect(h.cookieVal(s, "ht_gate_tab")).toBeNull();
  });
});
