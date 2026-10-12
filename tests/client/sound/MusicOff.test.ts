import { describe, expect, it } from "vitest";
import { Features } from "../../../src/client/Features";

describe("music is off in our build", () => {
  it("has no tracks, so neither the menu theme nor the gameplay track is requested", () => {
    expect(Features.music).toBe(false);
  });
});
