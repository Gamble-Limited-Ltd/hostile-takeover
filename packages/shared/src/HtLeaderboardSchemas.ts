import { z } from "zod";

// Hostile Takeover only: the player leaderboard served by our API
// (GET /public/leaderboard/players). Kept out of ApiSchemas.ts, whose
// PlayerLeaderboardEntrySchema requires an `elo` we do not have.

export const HT_LEADERBOARD_SORTS = ["xp", "wins", "games", "winrate"] as const;
export type HtLeaderboardSort = (typeof HT_LEADERBOARD_SORTS)[number];

export const HT_LEADERBOARD_PAGE_SIZE = 50;
/** Win rate only ranks players with at least this many games. */
export const HT_LEADERBOARD_MIN_GAMES = 10;

export const HtLeaderboardEntrySchema = z.object({
  rank: z.number().int().min(1),
  publicId: z.string(),
  username: z.string(),
  flag: z.string().nullable(),
  level: z.number().int().min(1),
  prestige: z.literal(0),
  lifetimeXp: z.number().int().min(0),
  games: z.number().int().min(0),
  wins: z.number().int().min(0),
  winRate: z.number().min(0).max(1),
  // Boss's account (rank THE_STRONGEST): crown beside the name. Omitted otherwise.
  root: z.literal(true).optional(),
});
export type HtLeaderboardEntry = z.infer<typeof HtLeaderboardEntrySchema>;

export const HtLeaderboardResponseSchema = z.object({
  sort: z.enum(HT_LEADERBOARD_SORTS),
  page: z.number().int().min(1),
  entries: HtLeaderboardEntrySchema.array(),
});
export type HtLeaderboardResponse = z.infer<typeof HtLeaderboardResponseSchema>;
