import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { StampedIntent } from "@openfront/engine-api/Schemas";
import { SCRIPTED_HUMANS, scriptedGameStart } from "./util/ScriptedGame";
import {
  findTarget,
  Harness,
  newHarness,
  ROOT,
  stepWith,
  takeoverIntent,
} from "./util/TakeoverHarness";

const TEST_TIMEOUT = 120_000;
const N = 300;

async function atTick(): Promise<Harness> {
  const h = await newHarness(scriptedGameStart({ bots: 20, nations: 8 }));
  while (h.runner.game.ticks() < N) stepWith(h.runner);
  return h;
}

const execsOf = (g: object, name: string) =>
  (g as unknown as { executions(): object[] })
    .executions()
    .filter((e) => e.constructor.name === name);

const takeoverMsgs = (h: Harness) =>
  h.displays.filter((d) => d.message === "events_display.admin_takeover");

describe("TakeoverExecution", () => {
  test(
    "takes over a nation, keeps its state, stops its AI, announces once",
    async () => {
      const h = await atTick();
      const g = h.runner.game;
      const nation = findTarget(g, PlayerType.Nation);
      const before = { id: nation.id(), smallID: nation.smallID() };
      const aiBefore = execsOf(g, "NationExecution").length;
      stepWith(h.runner, [takeoverIntent(nation.id())]);
      const p = g.playerByClientID(ROOT)!;
      expect(p.id()).toBe(before.id);
      expect(p.smallID()).toBe(before.smallID);
      expect(p.type()).toBe(PlayerType.Human);
      expect(p.name()).toBe("rootname");
      expect(p.isAlive()).toBe(true);
      expect(takeoverMsgs(h)).toHaveLength(1);
      expect(takeoverMsgs(h)[0].params?.admin).toBe("rootname");

      for (let i = 0; i < 40; i++) stepWith(h.runner);
      expect(execsOf(g, "NationExecution").length).toBeLessThan(aiBefore);
      expect(takeoverMsgs(h)).toHaveLength(1);
    },
    TEST_TIMEOUT,
  );

  test(
    "root's later intents execute",
    async () => {
      const h = await atTick();
      const g = h.runner.game;
      stepWith(h.runner, [
        takeoverIntent(findTarget(g, PlayerType.Nation).id()),
      ]);
      const p = g.playerByClientID(ROOT)!;
      const other = g
        .players()
        .find((o) => o !== p && o.isPlayer() && o.isAlive())!;
      expect(p.hasEmbargoAgainst(other)).toBe(false);
      const embargo: StampedIntent = {
        type: "embargo",
        targetID: other.id(),
        action: "start",
        clientID: ROOT,
      };
      stepWith(h.runner, [embargo]);
      stepWith(h.runner);
      expect(p.hasEmbargoAgainst(other)).toBe(true);
    },
    TEST_TIMEOUT,
  );

  test(
    "takes over a tribe (Bot)",
    async () => {
      const h = await atTick();
      const bot = findTarget(h.runner.game, PlayerType.Bot);
      stepWith(h.runner, [takeoverIntent(bot.id())]);
      const p = h.runner.game.playerByClientID(ROOT)!;
      expect(p.id()).toBe(bot.id());
      expect(p.type()).toBe(PlayerType.Human);
      for (let i = 0; i < 60; i++) stepWith(h.runner);
      expect(h.runner.game.playerByClientID(ROOT)!.id()).toBe(bot.id());
    },
    TEST_TIMEOUT,
  );

  test(
    "invalid targets are no-ops",
    async () => {
      const h = await atTick();
      const g = h.runner.game;
      const human = g.playerByClientID(SCRIPTED_HUMANS[0])!;
      const nation = findTarget(g, PlayerType.Nation);
      const dead = g
        .allPlayers()
        .find((x) => !x.isAlive() && x.clientID() === null);
      stepWith(h.runner, [
        takeoverIntent(human.id()),
        takeoverIntent("MISSING1"),
        ...(dead ? [takeoverIntent(dead.id())] : []),
      ]);
      expect(g.playerByClientID(ROOT)).toBeNull();
      expect(human.clientID()).toBe(SCRIPTED_HUMANS[0]);

      stepWith(h.runner, [takeoverIntent(nation.id())]);
      expect(g.playerByClientID(ROOT)!.id()).toBe(nation.id());
      // Already taken, and a second target for the same sender.
      const other = findTarget(g, PlayerType.Nation);
      stepWith(h.runner, [
        takeoverIntent(nation.id(), "intruder", "ROOT2222"),
        takeoverIntent(other.id()),
      ]);
      expect(g.playerByClientID("ROOT2222")).toBeNull();
      expect(other.clientID()).toBeNull();
      expect(takeoverMsgs(h)).toHaveLength(1);
    },
    TEST_TIMEOUT,
  );
});
