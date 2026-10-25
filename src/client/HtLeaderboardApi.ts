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
    valueKey: "leaderboard_modal.wins",
  },
  htWinrate: {
    sort: "winrate",
    tabKey: "leaderboard_modal.win_rate_tab",
    valueKey: "leaderboard_modal.wins",
  },
};

/**
 * The row's value column: XP on the XP tab, wins elsewhere. The games and
 * win rate tabs already show their number in the Games and W/L columns.
 */
export function htLeaderboardValue(
  sort: HtLeaderboardSort,
  e: HtLeaderboardEntry,
): number {
  return sort === "xp" ? e.lifetimeXp : e.wins;
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
