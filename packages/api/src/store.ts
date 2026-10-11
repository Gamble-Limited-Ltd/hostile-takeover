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
  /** The session that rotated out of `id`, if any (newest first). */
  findSuccessor(id: string): Promise<SessionRow | null>;

  /** A user plus their password hash, by username or email (case-insensitive). */
  findCredentials(login: string): Promise<Credentials | null>;
  findPasswordHash(userId: string): Promise<string | null>;
  createUser(u: NewUser): Promise<CreateUserResult>;
  setPassword(userId: string, passwordHash: string): Promise<void>;
  /** Deletes the user; their sessions and resets go with them. */
  deleteUser(userId: string): Promise<void>;

  createReset(r: {
    userId: string;
    tokenHash: string;
    createdBy: string | null;
    expiresAt: Date;
  }): Promise<void>;
  /** Marks a live, unused token used (and any other open ones for that user); returns the user id. */
  consumeReset(tokenHash: string): Promise<string | null>;

  logAdmin(entry: {
    actor: string;
    action: string;
    target: string | null;
    detail?: Record<string, unknown>;
  }): Promise<void>;
}

export interface Credentials {
  user: UserRow;
  passwordHash: string;
}

export interface NewUser {
  publicId: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
}

export type CreateUserResult =
  | { ok: true; user: UserRow }
  | { ok: false; taken: "username" | "email" };

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
    async findSuccessor(id) {
      const r = await db.query(
        `SELECT id, user_id, expires_at, revoked_at FROM sessions
         WHERE rotated_from = $1 ORDER BY created_at DESC LIMIT 1`,
        [id],
      );
      return (r.rows[0] as SessionRow | undefined) ?? null;
    },
    async findCredentials(login) {
      const col = login.includes("@") ? "email" : "username";
      const r = await db.query(
        `SELECT ${USER_COLS}, password_hash FROM users WHERE ${col} = $1`,
        [login],
      );
      const row = r.rows[0];
      if (!row) return null;
      const { password_hash, ...user } = row;
      return { user: user as UserRow, passwordHash: password_hash as string };
    },
    async findPasswordHash(userId) {
      const r = await db.query(
        "SELECT password_hash FROM users WHERE id = $1",
        [userId],
      );
      return (r.rows[0]?.password_hash as string | undefined) ?? null;
    },
    async createUser(u) {
      try {
        const r = await db.query(
          `INSERT INTO users (public_id, username, first_name, last_name, email,
                              password_hash, age_confirmed_at)
           VALUES ($1, $2, $3, $4, $5, $6, now())
           RETURNING ${USER_COLS}`,
          [
            u.publicId,
            u.username,
            u.firstName,
            u.lastName,
            u.email,
            u.passwordHash,
          ],
        );
        return { ok: true, user: r.rows[0] as UserRow };
      } catch (e) {
        const err = e as { code?: string; constraint?: string };
        if (err.code === "23505") {
          const taken = err.constraint?.includes("email")
            ? "email"
            : "username";
          return { ok: false, taken };
        }
        throw e;
      }
    },
    async setPassword(userId, passwordHash) {
      await db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [
        userId,
        passwordHash,
      ]);
    },
    async deleteUser(userId) {
      await db.query("DELETE FROM users WHERE id = $1", [userId]);
    },
    async createReset(r) {
      await db.query(
        `INSERT INTO password_resets (user_id, token_hash, created_by, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [r.userId, r.tokenHash, r.createdBy, r.expiresAt],
      );
    },
    async consumeReset(tokenHash) {
      const r = await db.query(
        `UPDATE password_resets SET used_at = now()
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
         RETURNING user_id`,
        [tokenHash],
      );
      const userId = r.rows[0]?.user_id as string | undefined;
      if (!userId) return null;
      await db.query(
        "UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
        [userId],
      );
      return userId;
    },
    async logAdmin(e) {
      await db.query(
        "INSERT INTO admin_audit (actor, action, target, detail) VALUES ($1, $2, $3, $4)",
        [
          e.actor,
          e.action,
          e.target,
          e.detail ? JSON.stringify(e.detail) : null,
        ],
      );
    },
  };
}
