import { describe, expect, it } from "vitest";
import { shouldRequireSignIn } from "../../src/client/SignInJoinGate";

describe("shouldRequireSignIn", () => {
  it("requires sign-in for a signed-out web multiplayer join", () => {
    expect(shouldRequireSignIn(false, true, false)).toBe(true);
  });
  it("lets a signed-in player through", () => {
    expect(shouldRequireSignIn(false, true, true)).toBe(false);
  });
  it("does not gate singleplayer or replays", () => {
    expect(shouldRequireSignIn(false, false, false)).toBe(false);
  });
  it("leaves the desktop shell to its own gating", () => {
    expect(shouldRequireSignIn(true, true, false)).toBe(false);
  });
});
