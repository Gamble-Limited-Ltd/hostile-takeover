import type {
  GameXpResponse,
  ProgressionConfig,
  PublicProgress,
} from "@openfront/shared/ApiSchemas";
import type express from "express";
import { singleplayerGameId } from "./progression";
import type { Store } from "./store";
import type { UserRow } from "./userMe";
import { buildLevels, MAX_LEVEL, RULES_VERSION, toProgress } from "./xp/rules";

const notFound = (res: express.Response) =>
  void res.status(404).json({ error: "not_found" });

const BUCKET_TYPE: Record<string, string> = {
  singleplayer: "Singleplayer",
  public: "Public",
  private: "Private",
};

/**
 * Read side of progression (U2.3). Prestige, rewards and the recent-games list
 * are deliberately absent. Mounted before mountGameRoutes' catch-all 404.
 */
export function mountProgressionRoutes(
  app: express.Express,
  d: {
    store: Store;
    authenticate(
      req: express.Request,
    ): Promise<{ user: UserRow; role: unknown } | null>;
  },
): void {
  const { store, authenticate } = d;
  const wrap =
    (h: (req: express.Request, res: express.Response) => Promise<void>) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) =>
      h(req, res).catch(next);

  app.get(
    "/users/@me/xp/:gameId",
    wrap(async (req, res) => {
      const auth = await authenticate(req);
      if (!auth) return void res.status(401).json({ error: "unauthorized" });
      const gameId = String(req.params.gameId);
      const a = await store.getXpAward(
        [gameId, singleplayerGameId(gameId)],
        auth.user.id,
      );
      if (!a) return notFound(res);
      const body: GameXpResponse = a.result.eligible
        ? {
            eligible: true,
            gameId,
            breakdown: a.result,
            before: {
              prestige: 0,
              level: a.before.level,
              xpInLevel: a.before.xpInLevel,
              xpForNext: toProgress(a.before).xpForNext,
            },
            after: toProgress(a.after),
            levelsReached: a.levelsReached.map((level) => ({
              prestige: 0,
              level,
            })),
          }
        : { eligible: false, gameId, reason: a.result.reason };
      res.json(body);
    }),
  );

  app.get("/public/progression/config", (_req, res) => {
    const body: ProgressionConfig = {
      version: RULES_VERSION,
      maxLevel: MAX_LEVEL,
      maxPrestige: 0,
      levels: buildLevels(),
      flares: [],
    };
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(body);
  });

  app.get(
    "/public/player/:publicId/progress",
    wrap(async (req, res) => {
      const p = await store.getProfile(String(req.params.publicId));
      if (!p) return notFound(res);
      const g = toProgress(p.progress);
      const body: PublicProgress = {
        prestige: g.prestige,
        level: g.level,
        lifetimeXp: g.lifetimeXp,
        legend: false,
        xpInLevel: g.xpInLevel,
        xpForNext: g.xpForNext,
      };
      res.json(body);
    }),
  );

  // Recent games are not kept (decision), so the list is always empty.
  app.get("/public/player/:publicId/games", (_req, res) => {
    res.json({ results: [], nextCursor: null });
  });

  const profile = async (req: express.Request, res: express.Response) => {
    const p = await store.getProfile(String(req.params.publicId));
    if (!p) return notFound(res);
    // Bucket -> GameType key, game mode -> mode key. Difficulty is not
    // stored, so every leaf sits under "Medium" (the UI's "all" view merges).
    const totals = new Map<string, { games: number; wins: number }>();
    for (const b of p.buckets) {
      const type = BUCKET_TYPE[b.bucket];
      if (!type) continue;
      const key = `${type}|${b.gameMode === "Team" ? "Team" : "Free For All"}`;
      const t = totals.get(key) ?? { games: 0, wins: 0 };
      totals.set(key, { games: t.games + b.games, wins: t.wins + b.wins });
    }
    const stats: Record<string, Record<string, unknown>> = {};
    for (const [key, t] of totals) {
      const [type, mode] = key.split("|");
      (stats[type] ??= {})[mode] = {
        Medium: {
          wins: String(t.wins),
          losses: String(t.games - t.wins),
          total: String(t.games),
          stats: {},
        },
      };
    }
    res.json({
      createdAt: p.createdAt.toISOString(),
      username: p.username,
      stats,
      clans: [],
      displayClanTag: null,
    });
  };
  app.get("/public/player/:publicId", wrap(profile));
  app.get(
    "/player/:publicId",
    wrap(async (req, res) => {
      if (!(await authenticate(req)))
        return void res.status(401).json({ error: "unauthorized" });
      await profile(req, res);
    }),
  );
}
