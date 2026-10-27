import { describe, expect, it } from "vitest";

import {
  createGameWireContext,
  decodeServerMessage,
  encodeServerMessage,
} from "@openfront/shared/ZbinWire";

// The takeover intent rides the Turn with a sender (root spectator) and a
// target (a Nation) that are both outside the start roster.
describe("admin_takeover on the wire", () => {
  it("round-trips in a turn with a roster context", () => {
    const roster = [{ clientID: "abcd1234" }, { clientID: "efgh5678" }];
    const msg = {
      type: "turn" as const,
      turn: {
        turnNumber: 812,
        intents: [
          {
            type: "admin_takeover" as const,
            targetPlayerID: "u0um5pjc",
            name: "thestrongest",
            clientID: "rootSpec",
          },
        ],
      },
    };
    const bytes = encodeServerMessage(msg, createGameWireContext(roster));
    expect(decodeServerMessage(bytes, createGameWireContext(roster))).toEqual(
      msg,
    );
  });
});
