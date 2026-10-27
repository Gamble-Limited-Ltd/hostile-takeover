import { WirePlayerSchema } from "@openfront/shared/WireSchemas";
import { zb } from "@openfront/zbin";
import { describe, expect, it } from "vitest";

const Codec = zb.object(WirePlayerSchema.shape);

describe("cosmetics.root on the wire", () => {
  const base = {
    clientID: "cl001234",
    username: "thestrongest",
    clanTag: null,
  };
  it("round-trips root: true and leaves it absent otherwise", () => {
    for (const cosmetics of [
      { verified: true, root: true },
      { verified: true },
    ]) {
      const p = WirePlayerSchema.parse({ ...base, cosmetics });
      const back = Codec.parseBytes(Codec.serialize(p));
      expect(back.cosmetics).toEqual(cosmetics);
    }
  });
});
