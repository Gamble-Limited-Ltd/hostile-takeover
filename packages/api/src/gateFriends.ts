import express from "express";
import { z } from "zod";
import type { ApiEnv } from "./env";
import { gateBaseUrl, gateBasicAuth } from "./gatePresence";
import type { UserRow } from "./userMe";

// Friends live in GATE (GLL ID), one list for every Gamble Limited game
// (contract: GATE's docs/FRIENDS.md). These routes keep the client's old
// /friends* shapes and call GATE's server door for the signed-in player:
// HTTP Basic with our client id/secret and ?sub=<gate_sub> on every call.
//
// Id mapping: the client field `publicId` carries GATE's accountId for friends
// and the request id for requests (that is what accept/decline need);
// `username` is the GATE login name. HT profiles are not linked from here.

const TIMEOUT_MS = 5_000;
const PAGE_MAX = 50;

export function friendsEnabled(env: ApiEnv, source = process.env): boolean {
  return (
    source.HT_GATE_FRIENDS !== "off" &&
    env.gateIssuer !== "" &&
    env.gateClientId !== "" &&
    env.gateClientSecret !== ""
  );
}

const Friend = z.object({
  accountId: z.string(),
  loginName: z.string(),
  friendsSince: z.string(),
  online: z.object({ app: z.string() }).nullable().optional(),
});
const Req = z.object({
  id: z.string(),
  loginName: z.string(),
  createdAt: z.string(),
});
const FriendsBody = z.object({ friends: Friend.array() });
const RequestsBody = z.object({ incoming: Req.array(), outgoing: Req.array() });
const SendBody = z.object({ status: z.enum(["requested", "accepted"]) });
const Query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(20),
});
const Name = z.string().min(1).max(200);

class GateFail extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: string | null,
  ) {
    super(`gate ${status}`);
  }
}

type Fetch = typeof fetch;

export function mountGateFriends(
  app: express.Express,
  d: {
    env: ApiEnv;
    authenticate(req: express.Request): Promise<{ user: UserRow } | null>;
    fetchFn?: Fetch;
    log?: (msg: string) => void;
  },
): void {
  const { env, authenticate } = d;
  const fetchFn = d.fetchFn ?? fetch;
  const log = d.log ?? console.error;
  let lastProblem = "";

  async function gate<T = unknown>(
    sub: string,
    method: string,
    path: string,
    body?: unknown,
    schema?: z.ZodType<T>,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetchFn(
        `${gateBaseUrl(env)}/oidc/me/${path}?sub=${encodeURIComponent(sub)}`,
        {
          method,
          headers: {
            Authorization: gateBasicAuth(env),
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: "error",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
    } catch {
      throw new GateFail(0, null);
    }
    if (!res.ok) throw new GateFail(res.status, res.headers.get("retry-after"));
    const parsed = schema?.safeParse(await res.json().catch(() => null));
    if (parsed && !parsed.success) throw new GateFail(502, null);
    return (parsed ? parsed.data : null) as T;
  }

  // One handler wrapper: sign-in, GATE link, error mapping.
  const route =
    (
      run: (sub: string, req: express.Request) => Promise<unknown>,
    ): express.RequestHandler =>
    async (req, res, next) => {
      try {
        const auth = await authenticate(req);
        if (!auth) return void res.status(401).json({ error: "unauthorized" });
        const sub = auth.user.gate_sub;
        if (!sub) return void res.status(403).json({ error: "gate_required" });
        res.setHeader("Cache-Control", "no-store");
        res.json(await run(sub, req));
      } catch (e) {
        if (e instanceof z.ZodError)
          return void res.status(400).json({ error: "bad_request" });
        if (!(e instanceof GateFail)) return void next(e);
        if (e.status === 404 || e.status === 409 || e.status === 400)
          return void res.status(e.status).json({
            error: { 400: "bad_request", 404: "not_found", 409: "conflict" }[
              e.status
            ],
          });
        if (e.status === 429) {
          if (e.retryAfter) res.setHeader("Retry-After", e.retryAfter);
          return void res.status(429).json({ error: "rate_limited" });
        }
        // 401/403 (client not switched on), 5xx, timeouts: one calm answer.
        const problem = `HTTP ${e.status}`;
        if (problem !== lastProblem) log(`gate friends: ${problem}`);
        lastProblem = problem;
        res.status(503).json({ error: "friends_unavailable" });
      }
    };

  app.get(
    "/friends",
    route(async (sub, req) => {
      const q = Query.parse(req.query);
      const all = (await gate(sub, "GET", "friends", undefined, FriendsBody))
        .friends;
      const start = (q.page - 1) * q.limit;
      return {
        results: all.slice(start, start + q.limit).map((f) => ({
          publicId: f.accountId,
          username: f.loginName,
          createdAt: f.friendsSince,
          onlineApp: f.online?.app ?? null,
        })),
        total: all.length,
        page: q.page,
        limit: q.limit,
      };
    }),
  );

  app.get(
    "/friends/requests",
    route(async (sub) => {
      const r = await gate(
        sub,
        "GET",
        "friends/requests",
        undefined,
        RequestsBody,
      );
      const map = (x: z.infer<typeof Req>) => ({
        publicId: x.id,
        username: x.loginName,
        createdAt: x.createdAt,
      });
      return { incoming: r.incoming.map(map), outgoing: r.outgoing.map(map) };
    }),
  );

  app.post(
    "/friends/requests/:target",
    route(async (sub, req) => {
      const loginName = Name.parse(req.params.target);
      const r = await gate(
        sub,
        "POST",
        "friends/requests",
        { loginName },
        SendBody,
      );
      return { status: r.status };
    }),
  );

  app.post(
    "/friends/requests/:id/accept",
    route(async (sub, req) => {
      const id = Name.parse(req.params.id);
      await gate(
        sub,
        "POST",
        `friends/requests/${encodeURIComponent(id)}/accept`,
      );
      return { status: "accepted" };
    }),
  );

  app.delete(
    "/friends/requests/:id",
    route(async (sub, req) => {
      const id = Name.parse(req.params.id);
      await gate(sub, "DELETE", `friends/requests/${encodeURIComponent(id)}`);
      return { deleted: true };
    }),
  );

  app.delete(
    "/friends/:accountId",
    route(async (sub, req) => {
      const id = Name.parse(req.params.accountId);
      await gate(sub, "DELETE", `friends/${encodeURIComponent(id)}`);
      return { removed: true };
    }),
  );
}
