import { pairFor, requestHost } from "@openfront/shared/Wayfinder";
import type express from "express";

/**
 * The game and API origins of the generation this request arrived on, from the
 * Wayfinder host table. Null in legacy mode: callers then use the env values.
 */
export function wayfinderOrigins(
  req: Pick<express.Request, "headers" | "socket">,
): { gameHost: string; gameOrigin: string; apiOrigin: string } | null {
  const pair = pairFor(requestHost(req.headers, req.socket.remoteAddress));
  return (
    pair && {
      gameHost: pair.ht,
      gameOrigin: `https://${pair.ht}`,
      apiOrigin: `https://${pair.htapi}`,
    }
  );
}
