import type { Express } from "express";
import type { GameManager } from "./GameManager";
import { verifyClientToken } from "./jwt";

// Fork-only (Hostile Takeover). Root-only list of this worker's started public
// games; the client asks every worker and merges.
export function registerAdminLiveGames(opts: {
  app: Express;
  gm: GameManager;
}): void {
  const { app, gm } = opts;
  app.get("/api/admin/live_games", async (req, res) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authorization header required" });
    }
    const auth = await verifyClientToken(header.substring("Bearer ".length));
    if (auth.type !== "success") {
      return res.status(401).json({ error: "Invalid token" });
    }
    if (auth.claims?.role !== "root") {
      return res.status(403).json({ error: "Forbidden" });
    }
    return res.json(gm.startedPublicGames().map((g) => g.adminSummary()));
  });
}
