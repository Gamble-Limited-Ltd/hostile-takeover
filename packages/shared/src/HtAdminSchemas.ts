// Fork-only (Hostile Takeover): admin tool wire schemas.
import { z } from "zod";

// GET /api/admin/live_games (root only). One worker's started public games.
export const AdminLiveGameSchema = z.object({
  gameID: z.string(),
  map: z.string(),
  mode: z.string(),
  gameType: z.string(),
  startedAt: z.number(),
  tick: z.number(),
  players: z.array(
    z.object({
      name: z.string(),
      clientID: z.string(),
      alive: z.boolean().optional(),
    }),
  ),
  // The server runs no simulation, so it cannot name tribes or nations; this
  // stays empty until a later slice can fill it.
  bots: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.enum(["Bot", "Nation"]),
    }),
  ),
});
export type AdminLiveGame = z.infer<typeof AdminLiveGameSchema>;

export const AdminLiveGamesSchema = z.array(AdminLiveGameSchema);
