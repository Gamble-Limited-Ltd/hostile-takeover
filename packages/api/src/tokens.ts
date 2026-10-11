import { uuidToBase64url } from "@openfront/shared/Base64";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ApiEnv } from "./env";
import type { SigningKeys } from "./keys";

export const JWT_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

export async function signJwt(
  keys: SigningKeys,
  env: Pick<ApiEnv, "apiUrl" | "domain">,
  user: { id: string; rank: string },
  now: Date = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  const claims: JWTPayload =
    user.rank === "THE_STRONGEST" ? { role: "root" } : {};
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "EdDSA", kid: keys.jwk.kid })
    .setJti(randomUUID())
    .setSubject(uuidToBase64url(user.id))
    .setIssuedAt(iat)
    .setExpirationTime(iat + JWT_TTL_SECONDS)
    .setIssuer(env.apiUrl)
    .setAudience(env.domain)
    .sign(keys.privateKey);
}

export async function verifyJwt(
  keys: SigningKeys,
  env: Pick<ApiEnv, "apiUrl" | "domain">,
  token: string,
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, keys.publicKey, {
    algorithms: ["EdDSA"],
    issuer: env.apiUrl,
    audience: env.domain,
  });
  return payload;
}

/** An opaque refresh token (32 random bytes) and its stored SHA-256. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
