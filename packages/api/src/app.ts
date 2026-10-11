import express from "express";

/** The slice of pg.Pool the app uses. */
export interface Queryable {
  query(sql: string): Promise<unknown>;
}

export function createApp(pool: Queryable): express.Express {
  const app = express();
  app.disable("x-powered-by");

  app.get("/healthz", async (_req, res) => {
    const db = await pool.query("SELECT 1").then(
      () => true,
      () => false,
    );
    res.json({ ok: true, db });
  });

  return app;
}
