import { randomBytes } from "node:crypto";

/** The one place a user's public_id is generated: 9 random bytes, base64url. */
export function generatePublicId(): string {
  return randomBytes(9).toString("base64url");
}
