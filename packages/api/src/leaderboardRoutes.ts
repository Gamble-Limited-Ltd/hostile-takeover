import {
  HT_LEADERBOARD_PAGE_SIZE,
  HT_LEADERBOARD_SORTS,
  type HtLeaderboardResponse,
  type HtLeaderboardSort,
} from "@openfront/shared/HtLeaderboardSchemas";
import type express from "express";
import type { Store } from "./store";

const CACHE_MS = 45_000;

/** Public player leaderboard (U2.5), fork-only. Mounted before mountGameRoutes' catch-all 404. */
export function mountLeaderboardRoutes(
  app: express.Express,
  d: { store: Store },
): void {
  // shortcut: per-process, bounded by clearing; fine for one API process.
  const cache = new Map<string, { at: number; body: HtLeaderboardResponse }>();
  app.get("/public/leaderboard/players", async (req, res, next) => {
    try {
      const sort = String(req.query.sort ?? "xp") as HtLeaderboardSort;
      const page = Number(req.query.page ?? 1);
      if (!HT_LEADERBOARD_SORTS.includes(sort))
        return void res.status(400).json({ error: "sort_invalid" });
      if (!Number.isInteger(page) || page < 1 || page > 10_000)
        return void res.status(400).json({ error: "page_invalid" });
      const hit = cache.get(`${sort}:${page}`);
      if (hit && Date.now() - hit.at < CACHE_MS) {
        res.setHeader("Cache-Control", "public, max-age=60");
        return void res.json(hit.body);
      }
      const offset = (page - 1) * HT_LEADERBOARD_PAGE_SIZE;
      const rows = await d.store.listLeaderboard(
        sort,
        HT_LEADERBOARD_PAGE_SIZE,
        offset,
      );
      const body: HtLeaderboardResponse = {
        sort,
        page,
        entries: rows.map((r, i) => ({
          rank: offset + i + 1,
          publicId: r.publicId,
          username: r.username,
          flag: r.flag,
          level: r.progress.level,
          prestige: 0,
          lifetimeXp: r.progress.lifetimeXp,
          games: r.games,
          wins: r.wins,
          winRate: r.games > 0 ? r.wins / r.games : 0,
          ...(r.rank === "THE_STRONGEST" ? { root: true as const } : {}),
        })),
      };
      if (cache.size >= 500) cache.clear();
      cache.set(`${sort}:${page}`, { at: Date.now(), body });
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json(body);
    } catch (e) {
      next(e);
    }
  });
}
