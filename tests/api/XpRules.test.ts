// @vitest-environment node
import {
  ProgressionConfigSchema,
  ProgressSchema,
  XpBreakdownSchema,
} from "@openfront/shared/ApiSchemas";
import { describe, expect, test } from "vitest";
import {
  applyXp,
  buildLevels,
  MAX_LEVEL,
  RULES_VERSION,
  scoreGame,
  toProgress,
  xpToNext,
  type GameXpInput,
  type ProgressState,
} from "../../packages/api/src/xp/rules";

const base: GameXpInput = {
  durationMs: 10 * 60_000,
  timeAliveMs: 10 * 60_000,
  placement: 4,
  playerCount: 8,
  won: false,
  isTeamGame: false,
  leftEarlyAlive: false,
  firstGameOfDay: false,
  feats: { mostTerritory: false, eliminatedPlayer: false, survived: false },
  source: "server",
  humanCount: 8,
  isPrivate: false,
  statsAgreed: true,
};

function score(over: Partial<GameXpInput> = {}) {
  const r = scoreGame({ ...base, ...over });
  if (!r.eligible) throw new Error(`ineligible: ${r.reason}`);
  // zod strips the extra `eligible` key
  expect(XpBreakdownSchema.parse(r)).toMatchObject({ total: r.total });
  return r;
}

const start: ProgressState = {
  prestige: 0,
  level: 1,
  xpInLevel: 0,
  lifetimeXp: 0,
};

describe("curve", () => {
  test("matches the plan and the config schema", () => {
    expect(RULES_VERSION).toBe(1);
    expect(xpToNext(1)).toBe(100);
    expect(xpToNext(99)).toBe(492);
    const levels = buildLevels();
    expect(levels).toHaveLength(MAX_LEVEL);
    expect(levels[99].cumulativeXp).toBe(29_304);
    const cfg = { version: 1, maxLevel: MAX_LEVEL, maxPrestige: 0, levels };
    expect(ProgressionConfigSchema.parse(cfg).levels).toHaveLength(MAX_LEVEL);
  });
});

describe("scoreGame", () => {
  test("plain game", () => {
    // placement 4 of 8: floor(30*4/7)=17; time 30; played 20
    expect(score()).toMatchObject({
      played: 20,
      time: 30,
      placement: 17,
      win: 0,
      total: 67,
    });
  });
  test("ffa win vs team win, first place", () => {
    expect(score({ won: true, placement: 1 })).toMatchObject({
      placement: 30,
      win: 50,
    });
    expect(score({ won: true, placement: 1, isTeamGame: true }).win).toBe(35);
  });
  test("leaving early alive forfeits played, placement and win", () => {
    const r = score({ leftEarlyAlive: true, won: true, placement: 1 });
    expect(r).toMatchObject({
      leftEarly: true,
      played: 0,
      placement: 0,
      win: 0,
      time: 30,
    });
  });
  test("caps: time 60, feats 15", () => {
    const r = score({
      timeAliveMs: 45 * 60_000,
      durationMs: 45 * 60_000,
      feats: { mostTerritory: true, eliminatedPlayer: true, survived: true },
    });
    expect(r.time).toBe(60);
    expect(r.feats).toBe(15);
  });
  test("first game of the day", () => {
    expect(score({ firstGameOfDay: true }).firstGame).toBe(50);
  });
  test("permille paths use integer floor", () => {
    expect(score().gamePermille).toBe(1000);
    expect(score({ source: "singleplayer" })).toMatchObject({
      gamePermille: 500,
      total: 33,
    });
    expect(score({ isPrivate: true, humanCount: 2 }).gamePermille).toBe(500);
    expect(score({ isPrivate: true, humanCount: 3 }).gamePermille).toBe(1000);
    expect(score({ humanCount: 1 }).gamePermille).toBe(1000);
  });
  test("ineligible reasons", () => {
    expect(scoreGame({ ...base, durationMs: 119_999 })).toEqual({
      eligible: false,
      reason: "too_short",
    });
    expect(scoreGame({ ...base, hasAccount: false })).toEqual({
      eligible: false,
      reason: "no_account",
    });
    expect(scoreGame({ ...base, statsAgreed: false })).toEqual({
      eligible: false,
      reason: "stats_disputed",
    });
  });
});

describe("applyXp", () => {
  test("stays in level", () => {
    const r = applyXp(start, 60);
    expect(r.progress).toMatchObject({
      level: 1,
      xpInLevel: 60,
      lifetimeXp: 60,
    });
    expect(r.levelsReached).toEqual([]);
    expect(ProgressSchema.parse(toProgress(r.progress)).xpForNext).toBe(100);
  });
  test("multi-level jump", () => {
    // 100 + 104 + 108 = 312 -> level 4, 5 left over
    const r = applyXp(start, 317);
    expect(r.levelsReached).toEqual([2, 3, 4]);
    expect(r.progress).toMatchObject({ level: 4, xpInLevel: 5 });
  });
  test("cap at 100: xp stops, lifetime keeps counting", () => {
    const r = applyXp(
      { ...start, level: 99, xpInLevel: 400, lifetimeXp: 29_000 },
      1000,
    );
    expect(r.levelsReached).toEqual([100]);
    expect(r.progress).toMatchObject({
      level: 100,
      xpInLevel: 0,
      lifetimeXp: 30_000,
    });
    const again = applyXp(r.progress, 50);
    expect(again.progress).toMatchObject({
      level: 100,
      xpInLevel: 0,
      lifetimeXp: 30_050,
    });
    expect(again.levelsReached).toEqual([]);
    expect(ProgressSchema.parse(toProgress(again.progress)).xpForNext).toBe(0);
  });
});

// Deterministic PRNG (mulberry32) so the simulation never flakes.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("pace simulation", () => {
  const rows = ["profile | avg XP/game | games to 100"];
  for (const winPct of [10, 25, 40]) {
    test(`win rate ${winPct}% reaches 100 in 240-360 games`, () => {
      const rand = rng(winPct * 7919);
      let p = start;
      let games = 0;
      let xp = 0;
      while (p.level < MAX_LEVEL && games < 2000) {
        games++;
        const minutes = 8 + Math.floor(rand() * 18); // 8-25
        const won = rand() * 100 < winPct;
        const placement = won ? 1 : 2 + Math.floor(rand() * 7);
        const alive = won
          ? minutes
          : Math.max(1, Math.floor(minutes * (0.3 + 0.7 * rand())));
        const r = score({
          durationMs: minutes * 60_000,
          timeAliveMs: alive * 60_000,
          placement,
          won,
          firstGameOfDay: rand() < 0.25,
          feats: {
            mostTerritory: won && rand() < 0.5,
            eliminatedPlayer: rand() < 0.4,
            survived: won || rand() < 0.2,
          },
        });
        xp += r.total;
        p = applyXp(p, r.total).progress;
      }
      rows.push(`win ${winPct}% | ${Math.round(xp / games)} | ${games}`);
      if (winPct === 40) console.log(rows.join("\n"));
      expect(games).toBeGreaterThanOrEqual(240);
      expect(games).toBeLessThanOrEqual(360);
    });
  }
});
