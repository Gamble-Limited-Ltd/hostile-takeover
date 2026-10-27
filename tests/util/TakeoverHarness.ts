import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import {
  ErrorUpdate,
  GameUpdateType,
  GameUpdateViewData,
} from "@openfront/engine-api/game/GameUpdates";
import {
  GameStartInfo,
  StampedIntent,
  Turn,
} from "@openfront/engine-api/Schemas";
import { Game, Player } from "@openfront/engine/game/Game";
import {
  createGameRunner,
  createGameRunnerFromSnapshot,
  GameRunner,
} from "@openfront/engine/GameRunner";
import { readSnapshotHeader } from "@openfront/engine/snapshot/GameSnapshot";
import { loadMapFiles } from "@openfront/shared/GameMapLoader";
import { scriptedTurn, TestDataMapLoader } from "./ScriptedGame";

export const ROOT = "ROOTROOT";
export const MAP = "world";

export interface Harness {
  runner: GameRunner;
  displays: { message: string; params?: Record<string, string | number> }[];
}

function collector(displays: Harness["displays"]) {
  return (gu: GameUpdateViewData | ErrorUpdate) => {
    if ("errMsg" in gu) throw new Error(`${gu.errMsg}\n${gu.stack}`);
    for (const u of gu.updates[GameUpdateType.DisplayEvent] ?? []) {
      displays.push({ message: u.message, params: u.params });
    }
  };
}

export async function newHarness(start: GameStartInfo): Promise<Harness> {
  const displays: Harness["displays"] = [];
  const { gameMap, gameMapSize } = start.config;
  const runner = await createGameRunner(
    start,
    undefined,
    await loadMapFiles(new TestDataMapLoader(MAP), gameMap, gameMapSize),
    collector(displays),
  );
  return { runner, displays };
}

export async function restoreHarness(
  start: GameStartInfo,
  snapshot: Uint8Array,
): Promise<Harness> {
  const displays: Harness["displays"] = [];
  const { gameMap, gameMapSize } = readSnapshotHeader(snapshot).gameConfig;
  const runner = await createGameRunnerFromSnapshot(
    start,
    snapshot,
    undefined,
    await loadMapFiles(new TestDataMapLoader(MAP), gameMap, gameMapSize),
    collector(displays),
  );
  return { runner, displays };
}

export function hash(game: Game): number {
  return (game as unknown as { hash(): number }).hash();
}

/** Plays one tick with the scripted humans' intents plus `extra`. */
export function stepWith(
  runner: GameRunner,
  extra: StampedIntent[] = [],
): Turn {
  const turn = scriptedTurn(runner.game);
  turn.intents.push(...extra);
  replayTurn(runner, turn);
  return turn;
}

export function replayTurn(runner: GameRunner, turn: Turn): void {
  runner.addTurn(turn);
  if (!runner.executeNextTick()) throw new Error("tick failed");
}

export function findTarget(game: Game, type: PlayerType): Player {
  const p = game
    .players()
    .find((x) => x.type() === type && x.isAlive() && x.clientID() === null);
  if (p === undefined) throw new Error(`no alive ${type} target`);
  return p;
}

export function takeoverIntent(
  targetPlayerID: string,
  name = "rootname",
  clientID = ROOT,
): StampedIntent {
  return { type: "admin_takeover", targetPlayerID, name, clientID };
}
