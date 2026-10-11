import type { UserRow } from "./userMe";

export interface SessionRow {
  id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

/** Everything the auth routes need from the database. */
export interface Store {
  findUserByUsername(username: string): Promise<UserRow | null>;
  findUserById(id: string): Promise<UserRow | null>;
  createSession(s: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    rotatedFrom?: string;
    userAgent?: string;
  }): Promise<string>;
  findSessionByHash(hash: string): Promise<SessionRow | null>;
  /** Revokes the session if it is still live; true only for the caller that did. */
  rotateSession(id: string): Promise<boolean>;
  revokeSession(id: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
}

export interface SqlClient {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, any>[] }>;
}

const USER_COLS =
  "id, public_id, username::text AS username, first_name, last_name, email::text AS email, rank, disabled_at";

export function pgStore(db: SqlClient): Store {
  return {
    async findUserByUsername(username) {
      const r = await db.query(
        `SELECT ${USER_COLS} FROM users WHERE username = $1`,
        [username],
      );
      return (r.rows[0] as UserRow | undefined) ?? null;
    },
    async findUserById(id) {
      const r = await db.query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [
        id,
      ]);
      return (r.rows[0] as UserRow | undefined) ?? null;
    },
    async createSession(s) {
      const r = await db.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at, rotated_from, user_agent, last_used_at)
         VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
        [
          s.userId,
          s.tokenHash,
          s.expiresAt,
          s.rotatedFrom ?? null,
          s.userAgent ?? null,
        ],
      );
      return r.rows[0].id as string;
    },
    async findSessionByHash(hash) {
      const r = await db.query(
        "SELECT id, user_id, expires_at, revoked_at FROM sessions WHERE token_hash = $1",
        [hash],
      );
      return (r.rows[0] as SessionRow | undefined) ?? null;
    },
    async rotateSession(id) {
      const r = await db.query(
        `UPDATE sessions SET revoked_at = now(), last_used_at = now()
         WHERE id = $1 AND revoked_at IS NULL RETURNING id`,
        [id],
      );
      return r.rows.length === 1;
    },
    async revokeSession(id) {
      await db.query(
        "UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL",
        [id],
      );
    },
    async revokeAllForUser(userId) {
      await db.query(
        "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
        [userId],
      );
    },
  };
}
