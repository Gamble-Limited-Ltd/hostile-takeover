import { errors, jwtVerify, type JWTVerifyGetKey } from "jose";

export type LaunchErrorCode = "invalid" | "expired" | "replay";

export class LaunchError extends Error {
  constructor(readonly code: LaunchErrorCode) {
    super(code);
  }
}

/** A seen ticket id is remembered a bit longer than the ticket can live. */
const SEEN_MS = 120_000;

/**
 * Checks a HALL launch ticket: EdDSA signature (HALL's published key), issuer,
 * audience (this game's client id), expiry, and that its jti was never used.
 * The seen set is in memory: shortcut, a restart forgets it, which the 60 s
 * ticket lifetime makes harmless.
 */
export function createLaunchVerifier(o: {
  issuer: string;
  audience: string;
  keys: JWTVerifyGetKey;
}) {
  const seen = new Map<string, number>();
  return async (ticket: string) => {
    let payload;
    try {
      ({ payload } = await jwtVerify(ticket, o.keys, {
        issuer: o.issuer,
        audience: o.audience,
        algorithms: ["EdDSA"],
        clockTolerance: 5,
        maxTokenAge: "120s",
        requiredClaims: ["exp", "iat", "jti", "sub"],
      }));
    } catch (e) {
      throw new LaunchError(
        e instanceof errors.JWTExpired ? "expired" : "invalid",
      );
    }
    const now = Date.now();
    for (const [id, until] of seen) if (until <= now) seen.delete(id);
    if (seen.has(payload.jti!)) throw new LaunchError("replay");
    seen.set(payload.jti!, now + SEEN_MS);
    return payload;
  };
}
