import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { describe, expect, it } from "vitest";
import {
  makeEmptyGu,
  makeGameView,
  makeNameViewData,
  makePlayerUpdate,
} from "../../util/viewStubs";

// Fork-only (S5): after a takeover the engine sends a partial update with the
// nation's new clientID, name and type. The view must apply it, or the root
// spectator never gets a player and everyone keeps seeing the nation.
describe("takeover reaches the view", () => {
  it("applies clientID, name and type from a later partial update", () => {
    const game = makeGameView({
      myClientID: "rootSpec",
      myUsername: "thestrongest",
    });
    const first = makeEmptyGu(1);
    first.updates[GameUpdateType.Player] = [
      makePlayerUpdate({
        id: "nation",
        smallID: 1,
        clientID: null,
        name: "Bhutan",
        displayName: "Bhutan",
        playerType: PlayerType.Nation,
      }),
    ];
    first.playerNameViewData = { nation: makeNameViewData() };
    game.update(first);
    expect(game.myPlayer()).toBeNull();

    const later = makeEmptyGu(2);
    later.updates[GameUpdateType.Player] = [
      {
        type: GameUpdateType.Player,
        id: "nation",
        clientID: "rootSpec",
        name: "thestrongest",
        displayName: "thestrongest",
        playerType: PlayerType.Human,
      },
    ];
    game.update(later);

    const p = game.player("nation");
    expect(p.clientID()).toBe("rootSpec");
    expect(p.name()).toBe("thestrongest");
    expect(p.displayName()).toBe("thestrongest");
    expect(p.type()).toBe(PlayerType.Human);
    expect(game.myPlayer()).toBe(p);
    expect(p.isMe()).toBe(true);
  });
});
