import { describe, expect, it } from "vitest";
import {
  FORK_SOURCE_URL,
  GAMBLE_LIMITED_URL,
  UPSTREAM_SOURCE_URL,
  meridianUrl,
  safeHttpUrl,
} from "../../src/client/ForkLinks";

describe("ForkLinks", () => {
  it("hides the Meridian link unless a build sets MERIDIAN_URL", () => {
    expect(meridianUrl()).toBe("");
  });

  it("only passes http(s) URLs through", () => {
    expect(safeHttpUrl(undefined)).toBe("");
    expect(safeHttpUrl("  ")).toBe("");
    expect(safeHttpUrl("javascript:alert(1)")).toBe("");
    expect(safeHttpUrl("not a url")).toBe("");
    expect(safeHttpUrl(" https://meridian.example.org ")).toBe(
      "https://meridian.example.org",
    );
  });

  it("points the attribution at the fork and upstream", () => {
    expect(FORK_SOURCE_URL).toBe(
      "https://github.com/Gamble-Limited-Ltd/hostile-takeover",
    );
    expect(UPSTREAM_SOURCE_URL).toBe(
      "https://github.com/openfrontio/openfrontio",
    );
    expect(GAMBLE_LIMITED_URL).toBe(
      "https://icantstopwinning.taps-holdings.org",
    );
  });
});
