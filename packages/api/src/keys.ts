import { calculateJwkThumbprint, type JWK } from "jose";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_KEY_FILE, readEnv } from "./env";

export interface SigningKeys {
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** Public JWK as published at /.well-known/jwks.json. */
  jwk: JWK & { kid: string };
}

export function generatePrivateKeyPem(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  return privateKey.export({ type: "pkcs8", format: "pem" }) as string;
}

export async function keysFromPem(pem: string): Promise<SigningKeys> {
  const privateKey = createPrivateKey(pem);
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("The JWT key must be an Ed25519 key");
  }
  const publicKey = createPublicKey(privateKey);
  const raw = publicKey.export({ format: "jwk" });
  const base = { kty: "OKP", crv: "Ed25519", x: raw.x as string };
  const kid = await calculateJwkThumbprint(base);
  return {
    privateKey,
    publicKey,
    jwk: { ...base, alg: "EdDSA", use: "sig", kid },
  };
}

/** Loads the key at boot; fails with a message saying how to create it. */
export async function loadSigningKeys(file: string): Promise<SigningKeys> {
  let pem: string;
  try {
    pem = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(
      `JWT signing key not found at ${file}. Run \`npm run api:keygen\` ` +
        `(or set HT_JWT_PRIVATE_KEY_FILE to an existing PKCS8 PEM).`,
    );
  }
  return keysFromPem(pem);
}

/** Writes a new key (mode 600). Refuses to overwrite unless `force`. */
export function writeNewKey(file: string, force: boolean): void {
  if (fs.existsSync(file) && !force) {
    throw new Error(`${file} already exists; pass --force to overwrite it.`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, generatePrivateKeyPem(), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

// `npm run api:keygen [-- --force]`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = readEnv().jwtPrivateKeyFile || DEFAULT_KEY_FILE;
  try {
    writeNewKey(file, process.argv.includes("--force"));
    console.log(`Wrote a new Ed25519 signing key to ${file}`);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}
