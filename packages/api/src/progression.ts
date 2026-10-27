import type { GameEndInfo } from "@openfront/shared/WireSchemas";
import type { GamePlayerRow, GameRow, Store } from "./store";
import {
  applyXp,
  RULES_VERSION,
  scoreGame,
  type GameXpInput,
} from "./xp/rules";

const TICK_MS = 100;
/** Singleplayer records are client-supplied: cap how many a user banks per UTC day. */
const SINGLEPLAYER_DAILY_CAP = 25;

/** The America/Chicago calendar day (YYYY-MM-DD) of a timestamp. */
export function chicagoDay(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", {
    timeZone: "America/Chicago",
  });
}

/** Singleplayer ids are namespaced so a client can't claim a server game's id. */
export const singleplayerGameId = (gameID: string) => `sp:${gameID}`;

const num = (v: unknown): number => (v === undefined ? 0 : Number(v));

/**
 * Scores and stores one finished game. `onlyUser` limits the credit to one
 * account (singleplayer). False when the game id was already stored.
 *
 * Derived from the record: placement (winner 1; eliminated players use the
 * engine's deathPosition; survivors rank by finalTiles), time alive (killedAt
 * ticks, else the whole game), feats (survived = not eliminated and not left
 * early; eliminatedPlayer = any conquest; mostTerritory = strictly most
 * finalTiles among the record's humans, never in a one-player record).
 * Not derivable: a multiplayer disconnect, so leftEarlyAlive is only set for
 * singleplayer (alive at the end with no winner = quit).
 */
export async function ingestGame(
  store: Store,
  info: GameEndInfo,
  source: "server" | "singleplayer",
  onlyUser?: string,
  /** Stores the game but awards no XP (takeover, admin-flagged). */
  unrankedReason?: string | null,
): Promise<boolean> {
  const { config } = info;
  const durationMs = info.end - info.start;
  const isTeamGame = config.gameMode === "Team";
  const isPrivate = config.gameType === "Private";
  const humans = info.players;
  // ["player", id] or ["team" | "nation", name, ...ids]
  const winnerIds = new Set(
    info.winner ? info.winner.slice(info.winner[0] === "player" ? 1 : 2) : [],
  );
  const tiles = (p: (typeof humans)[number]) => num(p.stats?.finalTiles);
  const alive = (p: (typeof humans)[number]) => p.stats?.killedAt === undefined;
  const topTiles = Math.max(...humans.map(tiles));
  const playerCount = Math.max(
    humans.length,
    ...humans.map((p) => p.stats?.deathPosition ?? 0),
  );

  if (
    source === "singleplayer" &&
    onlyUser &&
    (await store.countSingleplayerToday(onlyUser)) >= SINGLEPLAYER_DAILY_CAP
  ) {
    return false;
  }

  const rows: GamePlayerRow[] = [];
  for (const p of humans) {
    if (!p.persistentID || (onlyUser && p.persistentID !== onlyUser)) continue;
    const won = winnerIds.has(p.clientID);
    const stillAlive = alive(p);
    const leftEarly = source === "singleplayer" && stillAlive && !info.winner;
    const placement = won
      ? 1
      : (p.stats?.deathPosition ??
        1 +
          humans.filter(
            (o) =>
              o !== p && (winnerIds.has(o.clientID) || tiles(o) > tiles(p)),
          ).length);
    rows.push({
      userId: p.persistentID,
      placement,
      won,
      timeAliveMs: stillAlive
        ? durationMs
        : Math.min(durationMs, num(p.stats?.killedAt) * TICK_MS),
      leftEarly,
      mostTerritory:
        humans.length > 1 &&
        tiles(p) > 0 &&
        tiles(p) === topTiles &&
        humans.filter((o) => tiles(o) === topTiles).length === 1,
      eliminatedPlayer: (p.stats?.conquests ?? []).some((c) => num(c) > 0),
      survived: stillAlive && !leftEarly,
    });
  }

  const gameType = config.gameType;
  const game: GameRow = {
    id:
      source === "singleplayer" ? singleplayerGameId(info.gameID) : info.gameID,
    source,
    modeBucket:
      source === "singleplayer"
        ? "singleplayer"
        : isPrivate
          ? "private"
          : "public",
    gameType,
    gameMode: config.gameMode,
    map: config.gameMap,
    startedAt: new Date(info.start),
    endedAt: new Date(info.end),
    durationMs,
    winner: info.winner ?? null,
    unrankedReason: unrankedReason ?? null,
  };
  const day = chicagoDay(info.end);

  return store.recordGame(game, rows, (p, cur) => {
    const input: GameXpInput = {
      durationMs,
      timeAliveMs: p.timeAliveMs,
      placement: p.placement,
      playerCount,
      won: p.won,
      isTeamGame,
      leftEarlyAlive: p.leftEarly,
      firstGameOfDay: cur.lastXpDay !== day,
      feats: {
        mostTerritory: p.mostTerritory,
        eliminatedPlayer: p.eliminatedPlayer,
        survived: p.survived,
      },
      source,
      humanCount: humans.length,
      isPrivate,
      statsAgreed: info.statsAgreed !== false,
    };
    const result = scoreGame(input);
    if (unrankedReason || !result.eligible) {
      return {
        result,
        rulesVersion: RULES_VERSION,
        before: cur.state,
        after: cur.state,
        levelsReached: [],
        lastXpDay: cur.lastXpDay,
      };
    }
    const applied = applyXp(cur.state, result.total);
    return {
      result,
      rulesVersion: RULES_VERSION,
      before: cur.state,
      after: applied.progress,
      levelsReached: applied.levelsReached,
      lastXpDay: day,
    };
  });
}
