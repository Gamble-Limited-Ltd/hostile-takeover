import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/OwnLevelBadge", () => ({
  ownHiddenLevelBadge: () => undefined,
  refreshOwnHiddenLevelBadge: async () => undefined,
}));

import {
  lobbyPublicId,
  rememberLobbyRoster,
} from "../../src/client/LobbyRosterLevels";

describe("lobbyPublicId", () => {
  it("returns the publicId from the last roster of that game only", () => {
    rememberLobbyRoster("g1", [
      { clientID: "a", username: "A", clanTag: null, publicId: "pub-a" },
      { clientID: "b", username: "B", clanTag: null },
    ]);
    expect(lobbyPublicId("g1", "a")).toBe("pub-a");
    expect(lobbyPublicId("g1", "b")).toBeUndefined();
    expect(lobbyPublicId("g1", null)).toBeUndefined();
    expect(lobbyPublicId("other", "a")).toBeUndefined();
  });
});
