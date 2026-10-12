import { getProprietaryDir } from "./PublicAssetManifest";

/**
 * Hostile Takeover does not serve or bundle OpenFront's proprietary/ assets
 * (all rights reserved, licensed only inside the complete OpenFront package).
 * The files stay in the tree so upstream merges stay clean. Setting
 * SERVE_PROPRIETARY=true restores upstream's behaviour, for a build that is
 * the complete OpenFront package.
 */
export function serveProprietary(
  value: string | undefined = process.env.SERVE_PROPRIETARY,
): boolean {
  return value === "true" || value === "1";
}

/** The asset source directories, in precedence order. */
export function assetSourceDirs(
  resourcesDir: string,
  rootDir: string,
  serve: boolean = serveProprietary(),
): string[] {
  return serve ? [resourcesDir, getProprietaryDir(rootDir)] : [resourcesDir];
}
