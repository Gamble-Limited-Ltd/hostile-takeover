import {
  type HtLeaderboardEntry,
  HtLeaderboardResponseSchema,
  type HtLeaderboardSort,
} from "@openfront/shared/HtLeaderboardSchemas";
import { getApiBase } from "./ApiBase";

// Hostile Takeover leaderboard tabs (U2.5). Tab key -> API sort, plus the
// i18n keys for the tab label and the header of the value column.
export const HT_LEADERBOARD_TABS: Record<
  string,
  { sort: HtLeaderboardSort; tabKey: string; valueKey: string }
> = {
  htXp: {
    sort: "xp",
    tabKey: "leaderboard_modal.xp_tab",
    valueKey: "leaderboard_modal.xp",
  },
  htWins: {
    sort: "wins",
    tabKey: "leaderboard_modal.wins_tab",
    valueKey: "leaderboard_modal.wins",
  },
  htGames: {
    sort: "games",
    tabKey: "leaderboard_modal.games_tab",
    valueKey: "leaderboard_modal.games",
  },
  htWinrate: {
    sort: "winrate",
    tabKey: "leaderboard_modal.win_rate_tab",
    valueKey: "leaderboard_modal.win_rate",
  },
};

/** The number a tab ranks by, shown in the row's value column. */
export function htLeaderboardValue(
  sort: HtLeaderboardSort,
  e: HtLeaderboardEntry,
): number {
  if (sort === "xp") return e.lifetimeXp;
  if (sort === "wins") return e.wins;
  if (sort === "games") return e.games;
  return Math.round(e.winRate * 1000) / 10;
}

/** One page, or false on any failure. An empty page is the end of the list. */
export async function fetchHtLeaderboard(
  sort: HtLeaderboardSort,
  page: number,
): Promise<HtLeaderboardEntry[] | false> {
  try {
    const res = await fetch(
      `${getApiBase()}/public/leaderboard/players?sort=${sort}&page=${page}`,
    );
    if (!res.ok) return false;
    const parsed = HtLeaderboardResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.entries : false;
  } catch {
    return false;
  }
}
