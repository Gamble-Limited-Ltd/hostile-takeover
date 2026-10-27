import { GameType, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { beforeEach, describe, expect, it, vi } from "vitest";

const confirm = vi.hoisted(() => vi.fn());
vi.mock("../../src/client/InGameModal", () => ({
  showInGameConfirm: confirm,
}));
const features = vi.hoisted(() => ({ adminTakeover: true }));
vi.mock("../../src/client/Features", () => ({ Features: features }));
vi.mock("../../src/client/Utils", () => ({ translateText: (k: string) => k }));

import {
  canTakeOver,
  confirmTakeOver,
} from "../../src/client/hud/layers/TakeoverAction";
import { SendAdminTakeoverIntentEvent } from "../../src/client/LobbyEvents";

const game = (over: { my?: unknown; replay?: boolean; type?: GameType } = {}) =>
  ({
    myPlayer: () => over.my ?? null,
    config: () => ({
      isReplay: () => over.replay ?? false,
      gameConfig: () => ({ gameType: over.type ?? GameType.Public }),
    }),
  }) as never;
const target = (
  type = PlayerType.Nation,
  alive = true,
  cid: string | null = null,
) => ({ type: () => type, isAlive: () => alive, clientID: () => cid }) as never;

describe("takeover action", () => {
  beforeEach(() => confirm.mockReset());

  it("shows only for root spectators on alive Bot/Nation players", () => {
    expect(canTakeOver("root", game(), target())).toBe(true);
    expect(canTakeOver("root", game(), target(PlayerType.Bot))).toBe(true);
    expect(canTakeOver("root", game(), target(PlayerType.Human))).toBe(false);
    expect(canTakeOver("root", game(), target(PlayerType.Nation, false))).toBe(
      false,
    );
    expect(
      canTakeOver("root", game(), target(PlayerType.Nation, true, "ABCD1234")),
    ).toBe(false);
    expect(canTakeOver("admin", game(), target())).toBe(false);
    expect(canTakeOver(null, game(), target())).toBe(false);
    expect(canTakeOver("root", game({ my: {} }), target())).toBe(false);
    expect(canTakeOver("root", game({ replay: true }), target())).toBe(false);
    expect(
      canTakeOver("root", game({ type: GameType.Private }), target()),
    ).toBe(true);
    expect(
      canTakeOver("root", game({ type: GameType.Singleplayer }), target()),
    ).toBe(false);
  });

  it("is hidden when the feature switch is off", () => {
    features.adminTakeover = false;
    expect(canTakeOver("root", game(), target())).toBe(false);
    features.adminTakeover = true;
  });

  it("sends the intent only on confirm", async () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on(SendAdminTakeoverIntentEvent, (e) => seen.push(e.targetPlayerID));
    const t = { id: () => "nation01", displayName: () => "France" } as never;
    confirm.mockResolvedValueOnce(false);
    expect(await confirmTakeOver(bus, t)).toBe(false);
    expect(seen).toEqual([]);
    confirm.mockResolvedValueOnce(true);
    expect(await confirmTakeOver(bus, t)).toBe(true);
    expect(seen).toEqual(["nation01"]);
  });
});
