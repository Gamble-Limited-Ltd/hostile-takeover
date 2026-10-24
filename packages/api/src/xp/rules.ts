import type {
  Progress,
  ProgressionConfig,
  XpBreakdown,
} from "@openfront/shared/ApiSchemas";

export const RULES_VERSION = 1;
export const MAX_LEVEL = 100;

const MIN_GAME_MS = 2 * 60_000;
const MINUTE_MS = 60_000;

export function xpToNext(level: number): number {
  return 100 + 4 * (level - 1);
}

export function buildLevels(): ProgressionConfig["levels"] {
  const levels: ProgressionConfig["levels"] = [];
  let cumulativeXp = 0;
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const next = level === MAX_LEVEL ? 0 : xpToNext(level);
    levels.push({ level, xpToNext: next, cumulativeXp });
    cumulativeXp += next;
  }
  return levels;
}

export interface GameXpInput {
  durationMs: number;
  timeAliveMs: number;
  /** 1 = first place. */
  placement: number;
  playerCount: number;
  won: boolean;
  isTeamGame: boolean;
  leftEarlyAlive: boolean;
  firstGameOfDay: boolean;
  feats: {
    mostTerritory: boolean;
    eliminatedPlayer: boolean;
    survived: boolean;
  };
  source: "server" | "singleplayer";
  humanCount: number;
  isPrivate: boolean;
  /** False for a player with no account. */
  hasAccount?: boolean;
  statsAgreed: boolean;
}

export type XpResult =
  | ({ eligible: true } & XpBreakdown)
  | {
      eligible: false;
      reason: "too_short" | "no_account" | "stats_disputed";
    };

export function scoreGame(input: GameXpInput): XpResult {
  if (input.hasAccount === false) {
    return { eligible: false, reason: "no_account" };
  }
  if (input.durationMs < MIN_GAME_MS) {
    return { eligible: false, reason: "too_short" };
  }
  if (!input.statsAgreed) return { eligible: false, reason: "stats_disputed" };

  const forfeit = input.leftEarlyAlive;
  const played = forfeit ? 0 : 20;
  const time = Math.min(60, 3 * Math.floor(input.timeAliveMs / MINUTE_MS));
  const n = input.playerCount;
  const placement =
    forfeit || input.placement < 1
      ? 0
      : n <= 1
        ? 30
        : Math.floor((30 * Math.max(0, n - input.placement)) / (n - 1));
  const win = forfeit || !input.won ? 0 : input.isTeamGame ? 35 : 50;
  const firstGame = input.firstGameOfDay ? 50 : 0;
  const f = input.feats;
  const feats = Math.min(
    15,
    5 *
      (Number(f.mostTerritory) +
        Number(f.eliminatedPlayer) +
        Number(f.survived)),
  );
  const subtotal = played + time + placement + win + firstGame + feats;
  const gamePermille =
    input.source === "singleplayer" || (input.isPrivate && input.humanCount < 3)
      ? 500
      : 1000;
  return {
    eligible: true,
    leftEarly: forfeit,
    played,
    time,
    placement,
    win,
    firstGame,
    feats,
    subtotal,
    gamePermille,
    subscriberPermille: 1000,
    total: Math.floor((subtotal * gamePermille) / 1000),
  };
}

export interface ProgressState {
  prestige: 0;
  level: number;
  xpInLevel: number;
  lifetimeXp: number;
}

export function applyXp(
  progress: ProgressState,
  total: number,
): { progress: ProgressState; levelsReached: number[] } {
  let { level, xpInLevel } = progress;
  const levelsReached: number[] = [];
  if (level < MAX_LEVEL) {
    xpInLevel += total;
    while (level < MAX_LEVEL && xpInLevel >= xpToNext(level)) {
      xpInLevel -= xpToNext(level);
      level++;
      levelsReached.push(level);
    }
    // ProgressSchema: xpInLevel is 0 at level 100.
    if (level >= MAX_LEVEL) xpInLevel = 0;
  }
  return {
    progress: {
      prestige: 0,
      level,
      xpInLevel,
      lifetimeXp: progress.lifetimeXp + total,
    },
    levelsReached,
  };
}

export function toProgress(p: ProgressState): Progress {
  return {
    prestige: p.prestige,
    level: p.level,
    xpInLevel: p.xpInLevel,
    xpForNext: p.level >= MAX_LEVEL ? 0 : xpToNext(p.level),
    lifetimeXp: p.lifetimeXp,
    legend: false,
    canPrestige: false,
  };
}
