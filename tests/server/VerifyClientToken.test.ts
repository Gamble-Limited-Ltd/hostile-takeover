import { GameEnv } from "@openfront/shared/configuration/Env";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyClientToken } from "../../src/server/jwt";
import { ServerEnv } from "../../src/server/ServerEnv";

const PERSISTENT_ID = "00000000-0000-4000-8000-000000000000";

describe("verifyClientToken persistent IDs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects a raw persistent ID in production with reason persistent_id", async () => {
    vi.spyOn(ServerEnv, "env").mockReturnValue(GameEnv.Prod);
    const result = await verifyClientToken(PERSISTENT_ID);
    expect(result).toMatchObject({ type: "error", reason: "persistent_id" });
  });

  it("accepts a raw persistent ID in dev", async () => {
    vi.spyOn(ServerEnv, "env").mockReturnValue(GameEnv.Dev);
    const result = await verifyClientToken(PERSISTENT_ID);
    expect(result).toMatchObject({
      type: "success",
      persistentId: PERSISTENT_ID,
    });
  });

  it("marks a garbage token as invalid, not persistent_id", async () => {
    vi.spyOn(ServerEnv, "env").mockReturnValue(GameEnv.Prod);
    vi.spyOn(ServerEnv, "jwkPublicKey").mockRejectedValue(new Error("no key"));
    const result = await verifyClientToken("not-a-jwt");
    expect(result).toMatchObject({ type: "error", reason: "invalid" });
  });
});
