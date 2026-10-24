import express from "express";
import countries from "../../../resources/countries.json";
import type { Store } from "./store";
import type { UserRow } from "./userMe";

// Same rule as the game server's Privilege.isFlagAllowed for `country:` refs.
const CODES = new Set(
  countries
    .filter(
      (c) => !(c as { restricted?: boolean }).restricted && c.code !== "xx",
    )
    .map((c) => `country:${c.code}`),
);

/** Profile flag (U2.7): the player's saved `country:<code>` pick, fork-only endpoints. */
export function mountFlagRoutes(
  app: express.Express,
  d: {
    store: Store;
    authenticate(req: express.Request): Promise<{ user: UserRow } | null>;
  },
): void {
  const { store, authenticate } = d;
  app.get("/users/@me/flag", async (req, res, next) => {
    try {
      const auth = await authenticate(req);
      if (!auth) return void res.status(401).json({ error: "unauthorized" });
      res.json({ flag: await store.getFlag(auth.user.id) });
    } catch (e) {
      next(e);
    }
  });
  app.put(
    "/users/@me/flag",
    express.json({ limit: "1kb" }),
    async (req, res, next) => {
      try {
        const auth = await authenticate(req);
        if (!auth) return void res.status(401).json({ error: "unauthorized" });
        const flag = req.body?.flag;
        if (flag !== null && !(typeof flag === "string" && CODES.has(flag)))
          return void res.status(400).json({ error: "flag_invalid" });
        await store.setFlag(auth.user.id, flag);
        res.json({ flag });
      } catch (e) {
        next(e);
      }
    },
  );
}
