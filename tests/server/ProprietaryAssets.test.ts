import path from "path";
import { describe, expect, it } from "vitest";
import {
  assetSourceDirs,
  serveProprietary,
} from "../../src/server/ProprietaryAssets";
import {
  getProprietaryDir,
  getResourcesDir,
} from "../../src/server/PublicAssetManifest";

describe("proprietary/ is not served by default", () => {
  it("is off unless SERVE_PROPRIETARY is true", () => {
    expect(serveProprietary(undefined)).toBe(false);
    expect(serveProprietary("")).toBe(false);
    expect(serveProprietary("false")).toBe(false);
    expect(serveProprietary("true")).toBe(true);
  });

  it("the default source dirs are resources/ only", () => {
    const root = path.resolve(__dirname, "../..");
    const dirs = assetSourceDirs(getResourcesDir(root), root, false);
    expect(dirs).toEqual([getResourcesDir(root)]);
    expect(assetSourceDirs(getResourcesDir(root), root, true)).toContain(
      getProprietaryDir(root),
    );
  });
});
