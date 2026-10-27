import { MessageType, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { ClientID } from "@openfront/engine-api/Schemas";
import { z } from "zod";
import { Execution, Game } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type { ExecRecord } from "../snapshot/SnapshotContext";

// Fork-only (S5). Root takes over an alive Bot/Nation player. Every check is
// repeated here (the server cannot see the sim), so a bad target is a no-op on
// every client identically. Does its work in init and is never active.
export class TakeoverExecution implements Execution {
  constructor(
    private clientID: ClientID,
    private targetID: string,
    private name: string,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.targetID)) return;
    const target = mg.player(this.targetID);
    if (
      !target.isAlive() ||
      target.clientID() !== null ||
      (target.type() !== PlayerType.Bot &&
        target.type() !== PlayerType.Nation) ||
      mg.playerByClientID(this.clientID) !== null
    ) {
      return;
    }
    const botName = target.displayName();
    mg.takeOverPlayer(this.targetID, this.clientID, this.name);
    mg.displayMessage(
      "events_display.admin_takeover",
      MessageType.ALLIANCE_ACCEPTED,
      null,
      undefined,
      { admin: this.name, bot: botName },
    );
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(): ExecRecord {
    return TakeoverExecutionSnapshot.write({
      clientID: this.clientID,
      targetID: this.targetID,
      name: this.name,
    });
  }

  restoreSnapshot(s: TakeoverState): void {
    this.clientID = s.clientID;
    this.targetID = s.targetID;
    this.name = s.name;
  }
}

const TakeoverStateSchema = z.object({
  clientID: z.string(),
  targetID: z.string(),
  name: z.string(),
});
type TakeoverState = z.infer<typeof TakeoverStateSchema>;

export const TakeoverExecutionSnapshot = execSnapshotType({
  name: "Takeover",
  version: 1,
  schema: TakeoverStateSchema,
  cls: () => TakeoverExecution,
});
