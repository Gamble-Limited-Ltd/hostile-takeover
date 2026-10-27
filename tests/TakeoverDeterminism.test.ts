import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { StampedIntent, Turn } from "@openfront/engine-api/Schemas";
import { scriptedGameStart } from "./util/ScriptedGame";
import {
  findTarget,
  hash,
  newHarness,
  replayTurn,
  restoreHarness,
  ROOT,
  stepWith,
  takeoverIntent,
} from "./util/TakeoverHarness";

const TEST_TIMEOUT = 300_000;
const N = 300;
const END = N + 300;
const start = scriptedGameStart({ bots: 20, nations: 8 });

describe("takeover determinism", () => {
  test(
    "live run, replay from 0 and snapshot restores agree",
    async () => {
      const a = await newHarness(start);
      const turns: Turn[] = [];
      let afterSnap: Uint8Array | undefined;
      let beforeSnap: Uint8Array | undefined;
      let targetID = "";
      while (a.runner.game.ticks() < END) {
        const tick = a.runner.game.ticks();
        const extra: StampedIntent[] = [];
        if (tick === N) {
          beforeSnap = a.runner.snapshot();
          targetID = findTarget(a.runner.game, PlayerType.Nation).id();
          extra.push(takeoverIntent(targetID));
        }
        if (tick > N && tick % 7 === 0) {
          const p = a.runner.game.playerByClientID(ROOT)!;
          extra.push({
            type: "attack",
            targetID: null,
            troops: p.troops() / 4,
            clientID: ROOT,
          });
        }
        turns.push(stepWith(a.runner, extra));
        if (tick === N + 20) afterSnap = a.runner.snapshot();
      }
      const expected = hash(a.runner.game);
      expect(a.runner.game.playerByClientID(ROOT)!.id()).toBe(targetID);

      // B: replay every turn from 0 in a fresh game.
      const b = await newHarness(start);
      for (const t of turns) replayTurn(b.runner, t);
      expect(hash(b.runner.game)).toBe(expected);

      // C: restore after the takeover and continue.
      const c = await restoreHarness(start, afterSnap!);
      expect(c.runner.game.playerByClientID(ROOT)!.id()).toBe(targetID);
      for (const t of turns.slice(N + 21)) replayTurn(c.runner, t);
      expect(hash(c.runner.game)).toBe(expected);

      // D: restore just before the takeover, continue through it.
      const d = await restoreHarness(start, beforeSnap!);
      for (const t of turns.slice(N)) replayTurn(d.runner, t);
      expect(hash(d.runner.game)).toBe(expected);
    },
    TEST_TIMEOUT,
  );
});
