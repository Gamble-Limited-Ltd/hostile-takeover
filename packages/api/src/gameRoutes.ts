import { PartialAnalyticsRecordSchema } from "@openfront/shared/WireSchemas";
import { createHash } from "crypto";
import express from "express";
import { z } from "zod";
import newsItems from "../../../resources/news.json";
import { requireApiKey } from "./apiKey";
import { censorPlayer } from "./censor";
import { isLoopbackHost, type ApiEnv } from "./env";
import { ingestGame } from "./progression";
import type { Store } from "./store";
import type { UserRow } from "./userMe";

const JoinVerifyBodySchema = z.object({
  username: z.string().max(200),
  clanTag: z.string().max(200).nullable().optional(),
});

/**
 * The routes the game server and client call that Hostile Takeover answers
 * with fixed or empty data (Stage 1.4). Each comment names the caller and the
 * schema it parses. Anything not mounted here (matchmaking, clans, friends,
 * XP, public profiles, lobby queue) falls through to the 404 below.
 */
export function mountGameRoutes(
  app: express.Express,
  env: ApiEnv,
  d: {
    store: Store;
    authenticate(
      req: express.Request,
    ): Promise<{ user: UserRow; role: unknown } | null>;
  },
): void {
  const serverOnly = requireApiKey(env.apiKey);

  // Records carry every turn, so the limit is far above express's 100 kb.
  // express.json also inflates the singleplayer client's gzip body.
  const parseJson = express.json({ limit: "64mb" });
  /** The parsed body, or undefined after answering 4xx. */
  const readBody = (req: express.Request, res: express.Response) =>
    new Promise<unknown>((resolve) =>
      parseJson(req, res, (err) => {
        if (err) {
          res
            .status((err as { status?: number }).status ?? 400)
            .json({ error: "bad_request" });
          return resolve(undefined);
        }
        resolve(req.body ?? null);
      }),
    );
  const readInfo = async (req: express.Request, res: express.Response) => {
    const body = await readBody(req, res);
    if (body === undefined) return null;
    const parsed = PartialAnalyticsRecordSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request" });
      return null;
    }
    return parsed.data.info;
  };

  // Server: src/server/JoinVerify.ts verifyJoin(), parsed by its local
  // JoinVerifyVerdictSchema. There is no Turnstile here, so every join is
  // approved. The "approved" pair OVERWRITES the server's local censor result
  // (Worker.ts), so the same rules are applied here (see ./censor.ts).
  app.post("/join_verify", serverOnly, express.json(), (req, res) => {
    const body = JoinVerifyBodySchema.safeParse(req.body);
    if (!body.success) {
      return void res.status(400).json({ error: "bad_request" });
    }
    const { username, clanTag } = censorPlayer(
      body.data.username,
      body.data.clanTag ?? null,
    );
    res.json({ status: "approved", username, clanTag });
  });

  // Public. Server: src/server/PrivilegeRefresher.ts (CosmeticsSchema);
  // client: src/client/Cosmetics.ts (CosmeticsSchema). The smallest catalog
  // that parses: no patterns, flags or store items.
  app.get("/cosmetics.json", (_req, res) => {
    res.json({ patterns: {}, flags: {} });
  });

  // Public. Client: src/client/Api.ts getNews() (z.array(NewsItemSchema)),
  // which falls back to the same bundled file on any non-200. Serving it here
  // means the homepage load is not a 404 in the network log (Slice 3.5b).
  app.get("/news.json", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=60");
    if (!env.newsNotice) return void res.json(newsItems);
    const id =
      env.newsNoticeId ||
      createHash("sha256").update(env.newsNotice).digest("hex").slice(0, 8);
    res.json([
      {
        id: `url-notice-${id}`,
        title: env.newsNotice,
        description: env.newsNotice,
        url: null,
        type: "warning",
      },
      ...newsItems,
    ]);
  });

  // Server only: src/server/MapWeights.ts fetchMapWeights() (polled every 60 s).
  // Empty `maps` keeps the build's own weights.
  app.get("/map_weights", serverOnly, (_req, res) => {
    res.json({ maps: {} });
  });

  // Server: src/server/PrivilegeRefresher.ts (ReservedClanTagsResponseSchema,
  // an array of strings). Clans are hidden in v1, so no tag is reserved.
  app.get("/reserved_clan_tags", (_req, res) => {
    res.json([]);
  });

  // Server: src/server/CustomTribes.ts (`{ tribes: Tribe[] }`). An empty pool
  // means bots keep their organic names.
  app.post("/custom_tribes", serverOnly, express.json(), (_req, res) => {
    res.json({ tribes: [] });
  });

  // Public. Client: src/client/ServerList.ts (ServerListSchema in
  // packages/shared/src/ServerList.ts). One server, letter "a". `latest` is
  // omitted so no client is redirected to a /v/<commit>/ page. A loopback game
  // host (local dev) answers 404: the client then falls back to the page's own
  // origin, since it would otherwise build wss:// URLs to a server with no TLS.
  app.get("/cluster.json", (_req, res) => {
    if (isLoopbackHost(env.gameHost)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=5");
    res.json({
      servers: {
        a: {
          host: env.gameHost,
          numWorkers: 2,
          version: env.gameVersion,
          state: "open",
        },
      },
    });
  });

  // Server only: src/server/ClusterCheckin.ts sendCheckin(), which parses
  // `{ state }` (ServerStateSchema). We never drain or fence the one server.
  app.post("/cluster/checkin", serverOnly, express.json(), (_req, res) => {
    res.json({ state: "open" });
  });

  // Game records are not kept (no replays), only a summary and the XP.
  // POST: server src/server/Archive.ts archive(), which only checks
  // response.ok (a 4xx counts as final, a 409 after a retry as archived).
  // GET: server Archive.ts readGameRecord() and GamePreviewRoute.ts (both
  // treat non-ok as "no record"), and client src/client/JoinLobbyModal.ts
  // checkArchivedGame() (404 -> "not_found") plus
  // src/client/replay/ReplayRecord.ts. GET is answered by the 404 below.
  // A repeated POST changes nothing and is still a 204.
  app.post("/game/:id", serverOnly, async (req, res, next) => {
    try {
      const info = await readInfo(req, res);
      if (!info) return;
      if (info.gameID !== req.params.id) {
        return void res.status(400).json({ error: "bad_request" });
      }
      await ingestGame(d.store, info, "server");
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // Client: src/client/LocalServer.ts (gzip body, bearer token, only checks
  // response.ok). Auth comes before the body is read. Only the caller is
  // credited, and only when the record's single player is the caller.
  app.post("/archive_singleplayer_game", async (req, res, next) => {
    try {
      const who = await d.authenticate(req);
      if (!who) return void res.status(401).json({ error: "unauthorized" });
      const body = await readBody(req, res);
      if (body === undefined) return;
      const parsed = PartialAnalyticsRecordSchema.safeParse(body);
      const info = parsed.success ? parsed.data.info : null;
      const turns = (body as { turns?: unknown }).turns;
      const player = info?.players[0];
      const seconds = info ? info.duration : 0;
      if (
        !info ||
        info.config.gameType !== "Singleplayer" ||
        info.players.length !== 1 ||
        player?.persistentID !== who.user.id ||
        !Array.isArray(turns) ||
        turns.length > info.num_turns ||
        // 2 min to 6 h, start/end agreeing with duration and not in the future
        seconds < 120 ||
        seconds > 6 * 3600 ||
        Math.abs(info.end - info.start - seconds * 1000) > 2000 ||
        info.end > Date.now() + 60_000 ||
        // a forged old record can't backfill XP
        info.end < Date.now() - 24 * 3600_000 ||
        // turns are 100 ms: allow a wide band around 10 per second
        info.num_turns < seconds * 3 ||
        info.num_turns > seconds * 30
      ) {
        return void res.status(400).json({ error: "bad_request" });
      }
      const stored = await ingestGame(
        d.store,
        info,
        "singleplayer",
        who.user.id,
      );
      if (!stored) return void res.status(409).json({ error: "duplicate" });
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // Everything else is unimplemented in v1: ranked (/matchmaking/*), the lobby
  // queue (/users/@me/lobby_queue), clans, friends, XP, prestige, /public/*.
  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });
}
