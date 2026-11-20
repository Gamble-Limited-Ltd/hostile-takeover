import {
  requestLabel,
  requestPlayer,
  routesV2,
} from "@openfront/shared/Wayfinder";
import type express from "express";

/**
 * Wayfinder v2 owner check: a personal route belongs to one player. When the
 * signed-in sub differs from the edge's player header, tell Wayfinder so it
 * retires the route. Fire and forget: the sign-in is never blocked or delayed.
 */
export function reportLeak(
  req: Pick<express.Request, "headers" | "socket">,
  signedInSub: string,
): void {
  if (!routesV2()) return;
  const ra = req.socket.remoteAddress;
  const owner = requestPlayer(req.headers, ra);
  const label = requestLabel(req.headers, ra);
  const url = process.env.WAYFINDER_API_URL;
  const token = process.env.WAYFINDER_SERVICE_TOKEN;
  if (!owner || !label || owner === signedInSub || !url || !token) return;
  fetch(`${url.replace(/\/+$/, "")}/internal/leak`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ label, signedInSub }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}
