import type express from "express";
import { timingSafeEqual } from "node:crypto";

export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** True when the request carries the game server's x-api-key. */
export function hasValidApiKey(req: express.Request, apiKey: string): boolean {
  const given = req.headers["x-api-key"];
  return (
    typeof given === "string" && apiKey !== "" && sameSecret(given, apiKey)
  );
}

/** Middleware for routes only the game server calls. */
export function requireApiKey(apiKey: string): express.RequestHandler {
  return (req, res, next) => {
    if (!hasValidApiKey(req, apiKey)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}
