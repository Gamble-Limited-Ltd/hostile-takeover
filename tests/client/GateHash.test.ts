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
    expect(parseGateHash("#gate=ok")).toEqual({ kind: "ok" });
    expect(parseGateHash("#gate=link")).toEqual({ kind: "link" });
    expect(parseGateHash("#gate_error=denied")).toEqual({
      kind: "error",
      code: "denied",
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
