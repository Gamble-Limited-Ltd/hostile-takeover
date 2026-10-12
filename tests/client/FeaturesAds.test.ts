import { describe, expect, it } from "vitest";
import { Features } from "../../src/client/Features";

describe("Features.ads", () => {
  it("is permanently off", () => {
    expect(Features.ads).toBe(false);
  });
});
