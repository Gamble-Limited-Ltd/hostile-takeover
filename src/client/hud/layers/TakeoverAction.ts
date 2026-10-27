import { GameType, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { Features } from "../../Features";
import { showInGameConfirm } from "../../InGameModal";
import { SendAdminTakeoverIntentEvent } from "../../LobbyEvents";
import { translateText } from "../../Utils";
import type { GameView, PlayerView } from "../../view";

// Fork-only (S5): the "Take over" action in the player panel. Offered only to
// root, watching a multiplayer game with no player of their own, on an alive Bot
// or Nation. The server and the engine check everything again.
export function canTakeOver(
  role: string | null,
  game: Pick<GameView, "myPlayer" | "config">,
  target: Pick<PlayerView, "type" | "isAlive" | "clientID">,
): boolean {
  return (
    Features.adminTakeover &&
    role === "root" &&
    game.myPlayer() === null &&
    !game.config().isReplay() &&
    game.config().gameConfig().gameType !== GameType.Singleplayer &&
    target.isAlive() &&
    !target.clientID() &&
    (target.type() === PlayerType.Bot || target.type() === PlayerType.Nation)
  );
}

export async function confirmTakeOver(
  eventBus: EventBus,
  target: Pick<PlayerView, "id" | "displayName">,
): Promise<boolean> {
  const confirmed = await showInGameConfirm(
    translateText("admin.takeover.confirm", { name: target.displayName() }),
  );
  if (confirmed) {
    eventBus.emit(new SendAdminTakeoverIntentEvent(String(target.id())));
  }
  return confirmed;
}
