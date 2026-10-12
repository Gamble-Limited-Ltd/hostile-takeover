import express from "express";
import { z } from "zod";
import newsItems from "../../../resources/news.json";
import { requireApiKey } from "./apiKey";
import { censorPlayer } from "./censor";
import { isLoopbackHost, type ApiEnv } from "./env";

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
export function mountGameRoutes(app: express.Express, env: ApiEnv): void {
  const serverOnly = requireApiKey(env.apiKey);

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
    res.json(newsItems);
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

  // We keep no game records. POST: server src/server/Archive.ts archive(),
  // which only checks response.ok. GET: server Archive.ts readGameRecord()
  // and GamePreviewRoute.ts (both treat non-ok as "no record"), and client
  // src/client/JoinLobbyModal.ts checkArchivedGame() (404 -> "not_found")
  // plus src/client/replay/ReplayRecord.ts. GET is answered by the 404 below.
  app.post("/game/:id", serverOnly, (req, res) => {
    req.resume();
    res.status(204).end();
  });

  // Client: src/client/LocalServer.ts (sends a gzip body with a bearer token,
  // only checks response.ok). Accepted and discarded without reading.
  app.post("/archive_singleplayer_game", (req, res) => {
    req.resume();
    res.status(204).end();
  });

  // Everything else is unimplemented in v1: ranked (/matchmaking/*), the lobby
  // queue (/users/@me/lobby_queue), clans, friends, XP, prestige, /public/*.
  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });
}
