// @vitest-environment node
import express from "express";
import type { AddressInfo } from "node:net";
import { describe, expect, test, vi } from "vitest";
import type { ApiEnv } from "../../packages/api/src/env";
import {
  friendsEnabled,
  mountGateFriends,
} from "../../packages/api/src/gateFriends";
import type { UserRow } from "../../packages/api/src/userMe";

const env = {
  gateIssuer: "https://id.example",
  gateClientId: "hostile-takeover",
  gateClientSecret: "s3cret",
  gateDirectUrl: "http://gate:3301",
} as ApiEnv;

async function setup(gateSub: string | null, reply: () => Response) {
  const f = vi.fn(async (_u: string, _i: RequestInit) => reply());
  const app = express();
  mountGateFriends(app, {
    env,
    fetchFn: f as never,
    log: () => {},
    authenticate: async (req) =>
      req.headers.authorization
        ? { user: { gate_sub: gateSub } as UserRow }
        : null,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (method: string, path: string, auth = true) =>
    fetch(base + path, {
      method,
      headers: auth ? { authorization: "Bearer x" } : {},
    });
  return { f, call, close: () => server.close() };
}

const json = (b: unknown, status = 200, h: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status, headers: h });

describe("gate friends routes", () => {
  test("list maps accountId/loginName, pages, Basic auth and sub", async () => {
    const friends = [1, 2, 3].map((n) => ({
      accountId: `a${n}`,
      loginName: `Bob_${n}`,
      friendsSince: "2026-11-07T10:00:00.000Z",
      online: n === 1 ? { app: "meridian", since: "x" } : null,
      joinedAt: null,
    }));
    const h = await setup("sub-1", () => json({ friends }));
    try {
      const res = await h.call("GET", "/friends?page=2&limit=2");
      expect(await res.json()).toEqual({
        results: [
          {
            publicId: "a3",
            username: "Bob_3",
            createdAt: "2026-11-07T10:00:00.000Z",
            onlineApp: null,
          },
        ],
        total: 3,
        page: 2,
        limit: 2,
      });
      const [url, init] = h.f.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("http://gate:3301/oidc/me/friends?sub=sub-1");
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Basic " + Buffer.from("hostile-takeover:s3cret").toString("base64"),
      );
      const first = await (await h.call("GET", "/friends?limit=1")).json();
      expect(first.results[0].onlineApp).toBe("meridian");
    } finally {
      h.close();
    }
  });

  test("requests use the request id; send posts the login name", async () => {
    const r = { id: "r1", accountId: "a1", loginName: "Bob", createdAt: "t" };
    const h = await setup("sub-1", () => json({ incoming: [r], outgoing: [] }));
    try {
      const res = await h.call("GET", "/friends/requests");
      expect(await res.json()).toEqual({
        incoming: [{ publicId: "r1", username: "Bob", createdAt: "t" }],
        outgoing: [],
      });
    } finally {
      h.close();
    }
    const s = await setup("sub-1", () => json({ status: "requested" }, 201));
    try {
      const res = await s.call("POST", "/friends/requests/Bob_22");
      expect(await res.json()).toEqual({ status: "requested" });
      const init = s.f.mock.calls[0][1];
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({ loginName: "Bob_22" });
    } finally {
      s.close();
    }
  });

  test("accept, decline and remove call the matching GATE paths", async () => {
    const h = await setup("sub-1", () => json({ ok: true }));
    try {
      await h.call("POST", "/friends/requests/r1/accept");
      await h.call("DELETE", "/friends/requests/r1");
      await h.call("DELETE", "/friends/a1");
      expect(h.f.mock.calls.map((c) => `${c[1].method} ${c[0]}`)).toEqual([
        "POST http://gate:3301/oidc/me/friends/requests/r1/accept?sub=sub-1",
        "DELETE http://gate:3301/oidc/me/friends/requests/r1?sub=sub-1",
        "DELETE http://gate:3301/oidc/me/friends/a1?sub=sub-1",
      ]);
    } finally {
      h.close();
    }
  });

  test("errors: 404, 409, 429 keeps Retry-After, 401/403/5xx/garbage -> 503", async () => {
    const cases: [Response, number, string][] = [
      [json({ error: "not_found" }, 404), 404, "not_found"],
      [json({ error: "already_friends" }, 409), 409, "conflict"],
      [json({ error: "invalid_request" }, 400), 400, "bad_request"],
      [json({ error: "x" }, 429, { "Retry-After": "42" }), 429, "rate_limited"],
      [json({ error: "insufficient_scope" }, 403), 503, "friends_unavailable"],
      [json({ error: "invalid_client" }, 401), 503, "friends_unavailable"],
      [json({}, 500), 503, "friends_unavailable"],
      [json({ nope: 1 }), 503, "friends_unavailable"],
    ];
    for (const [reply, status, error] of cases) {
      const h = await setup("sub-1", () => reply.clone());
      try {
        const res = await h.call("GET", "/friends");
        expect(res.status).toBe(status);
        expect(await res.json()).toEqual({ error });
        if (status === 429) expect(res.headers.get("retry-after")).toBe("42");
      } finally {
        h.close();
      }
    }
  });

  test("signed out is 401; no gate_sub is 403 gate_required with no GATE call", async () => {
    const a = await setup("sub-1", () => json({ friends: [] }));
    const b = await setup(null, () => json({ friends: [] }));
    try {
      expect((await a.call("GET", "/friends", false)).status).toBe(401);
      const res = await b.call("GET", "/friends");
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "gate_required" });
      expect(b.f).not.toHaveBeenCalled();
    } finally {
      a.close();
      b.close();
    }
  });

  test("kill switch and missing GATE config", () => {
    expect(friendsEnabled(env, {})).toBe(true);
    expect(friendsEnabled(env, { HT_GATE_FRIENDS: "off" })).toBe(false);
    expect(friendsEnabled({ ...env, gateIssuer: "" }, {})).toBe(false);
  });
});
