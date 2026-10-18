import { describe, expect, it } from "vitest";
import {
  parseGateHash,
  stashGateError,
  stashGateLink,
  stashGateLogoutUrl,
  takeGateError,
  takeGateLink,
  takeGateLogoutUrl,
} from "../../src/client/GateHash";

describe("parseGateHash", () => {
  it("parses ok, link and error", () => {
    expect(parseGateHash("#gate=ok")).toEqual({ kind: "ok", tab: false });
    expect(parseGateHash("#gate=link")).toEqual({ kind: "link", tab: false });
    expect(parseGateHash("#gate_error=denied")).toEqual({
      kind: "error",
      code: "denied",
      tab: false,
    });
  });

  it("reads the new-tab flag", () => {
    expect(parseGateHash("#gate=ok&tab=1")).toEqual({ kind: "ok", tab: true });
    expect(parseGateHash("#gate=link&tab=1")).toEqual({
      kind: "link",
      tab: true,
    });
  });

  it("ignores garbage", () => {
    expect(parseGateHash("")).toBeNull();
    expect(parseGateHash("gate=ok")).toBeNull();
    expect(parseGateHash("#gate=nope")).toBeNull();
    expect(parseGateHash("#gate_error=")).toBeNull();
    expect(parseGateHash("#gate_error=<script>")).toBeNull();
    expect(parseGateHash("#modal=account")).toBeNull();
    expect(parseGateHash("#reset=abcdefabcdefabcdef")).toBeNull();
  });
});

describe("stash", () => {
  it("hands values out once", () => {
    stashGateLink();
    expect(takeGateLink()).toBe(true);
    expect(takeGateLink()).toBe(false);
    stashGateError("expired");
    expect(takeGateError()).toBe("expired");
    expect(takeGateError()).toBeNull();
    stashGateLogoutUrl("https://id.example/oidc/logout");
    expect(takeGateLogoutUrl()).toBe("https://id.example/oidc/logout");
    expect(takeGateLogoutUrl()).toBeNull();
  });
});
