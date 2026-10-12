import { describe, expect, it } from "vitest";
import { deepAssign } from "../../src/client/render/gl/SettingsUtils";

describe("deepAssign", () => {
  it("ignores prototype-polluting keys", () => {
    const target: Record<string, unknown> = { a: 1 };
    deepAssign(target, JSON.parse('{"__proto__":{"polluted":true},"a":2}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(target.a).toBe(2);
  });
});
