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
  findUserByEmail(email: string): Promise<UserRow | null>;
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

  // Sign in with GLL ID (GATE)
  findUserByGateSub(sub: string): Promise<UserRow | null>;
  /** Stores a started sign-in (sha256 of state, sha256 of the browser binding value). */
  createGateFlow(f: {
    stateHash: string;
    bindingHash: string;
    nonce: string;
    codeVerifier: string;
    expiresAt: Date;
  }): Promise<void>;
  /** Atomically marks a live, unused flow with this binding used; null when none. */
  consumeGateFlow(
    stateHash: string,
    bindingHash: string,
  ): Promise<GateFlowRow | null>;
  createGatePending(
    p: GatePendingRow & {
      tokenHash: string;
      expiresAt: Date;
    },
  ): Promise<void>;
  findGatePending(tokenHash: string): Promise<GatePendingRow | null>;
  deleteGatePending(tokenHash: string): Promise<void>;
  /** The user's latest GATE id_token (logout hint only); null when none. */
  findGateIdToken(userId: string): Promise<string | null>;
  setGateIdToken(userId: string, idToken: string): Promise<void>;
  /**
   * Links a GATE subject to an enabled, not-yet-linked user (race safe), and
   * sets their email to `email` when no other account holds it. "already_linked"
   * also covers the subject being linked to another user.
   */
  linkGate(
    userId: string,
    sub: string,
    email: string | null,
    idToken: string | null,
  ): Promise<LinkGateResult>;
  /** Sets the user's email unless another account holds it. */
  setEmailIfFree(userId: string, email: string): Promise<void>;
  /** A password-less, GATE-linked user. */
  createGateUser(u: {
    publicId: string;
    username: string;
    email: string;
    gateSub: string;
    idToken: string | null;
  }): Promise<CreateGateUserResult>;

  logAdmin(entry: {
    actor: string;
    action: string;
    target: string | null;
    detail?: Record<string, unknown>;
  }): Promise<void>;
}

export interface Credentials {
  user: UserRow;
  /** NULL for accounts created through GLL ID: they cannot sign in with a password. */
  passwordHash: string | null;
}

export interface GateFlowRow {
  nonce: string;
  codeVerifier: string;
}

export interface GatePendingRow {
  gateSub: string;
  email: string | null;
  loginName: string;
  /** GATE's `email_approved` claim; null when GATE sent none. Only true allows creating an account. */
  emailApproved: boolean | null;
  /** Raw GATE id_token, copied to the user on link/create. Never returned to clients. */
  idToken: string | null;
}

export type LinkGateResult = "ok" | "already_linked" | "gone";

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

export type CreateGateUserResult =
  | { ok: true; user: UserRow }
  | { ok: false; taken: "username" | "email" | "gate" };

export interface SqlClient {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, any>[] }>;
}

const USER_COLS =
  "id, public_id, username::text AS username, first_name, last_name, email::text AS email, rank, disabled_at, gate_sub";

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
    async findUserByEmail(email) {
      const r = await db.query(
        `SELECT ${USER_COLS} FROM users WHERE email = $1`,
        [email],
      );
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
      return {
        user: user as UserRow,
        passwordHash: (password_hash as string | null) ?? null,
      };
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
    async findUserByGateSub(sub) {
      const r = await db.query(
        `SELECT ${USER_COLS} FROM users WHERE gate_sub = $1`,
        [sub],
      );
      return (r.rows[0] as UserRow | undefined) ?? null;
    },
    async createGateFlow(f) {
      await db.query(
        "DELETE FROM gate_flows WHERE expires_at < now() - interval '1 day'",
      );
      await db.query(
        `INSERT INTO gate_flows (state_hash, binding_hash, nonce, code_verifier, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [f.stateHash, f.bindingHash, f.nonce, f.codeVerifier, f.expiresAt],
      );
    },
    async consumeGateFlow(stateHash, bindingHash) {
      const r = await db.query(
        `UPDATE gate_flows SET used_at = now()
         WHERE state_hash = $1 AND binding_hash = $2
           AND used_at IS NULL AND expires_at > now()
         RETURNING nonce, code_verifier`,
        [stateHash, bindingHash],
      );
      const row = r.rows[0];
      return row
        ? {
            nonce: row.nonce as string,
            codeVerifier: row.code_verifier as string,
          }
        : null;
    },
    async createGatePending(p) {
      await db.query(
        "DELETE FROM gate_pending WHERE expires_at < now() - interval '1 day'",
      );
      await db.query(
        `INSERT INTO gate_pending (token_hash, gate_sub, email, login_name, id_token, expires_at, email_approved)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          p.tokenHash,
          p.gateSub,
          p.email,
          p.loginName,
          p.idToken,
          p.expiresAt,
          p.emailApproved,
        ],
      );
    },
    async findGatePending(tokenHash) {
      const r = await db.query(
        `SELECT gate_sub, email, login_name, id_token, email_approved FROM gate_pending
         WHERE token_hash = $1 AND expires_at > now()`,
        [tokenHash],
      );
      const row = r.rows[0];
      return row
        ? {
            gateSub: row.gate_sub as string,
            email: (row.email as string | null) ?? null,
            loginName: row.login_name as string,
            emailApproved:
              row.email_approved === true
                ? true
                : row.email_approved === false
                  ? false
                  : null,
            idToken: (row.id_token as string | null) ?? null,
          }
        : null;
    },
    async deleteGatePending(tokenHash) {
      await db.query("DELETE FROM gate_pending WHERE token_hash = $1", [
        tokenHash,
      ]);
    },
    async findGateIdToken(userId) {
      const r = await db.query(
        "SELECT gate_id_token FROM users WHERE id = $1",
        [userId],
      );
      return (r.rows[0]?.gate_id_token as string | null | undefined) ?? null;
    },
    async setGateIdToken(userId, idToken) {
      await db.query("UPDATE users SET gate_id_token = $2 WHERE id = $1", [
        userId,
        idToken,
      ]);
    },
    async linkGate(userId, sub, email, idToken) {
      try {
        const r = await db.query(
          `UPDATE users SET gate_sub = $2, gate_id_token = $4,
             email = CASE WHEN $3::text IS NOT NULL AND NOT EXISTS
               (SELECT 1 FROM users o WHERE o.email = $3::text AND o.id <> $1)
               THEN $3::text ELSE email END
           WHERE id = $1 AND gate_sub IS NULL AND disabled_at IS NULL
           RETURNING id`,
          [userId, sub, email, idToken],
        );
        if (r.rows.length === 1) return "ok";
      } catch (e) {
        if ((e as { code?: string }).code === "23505") return "already_linked";
        throw e;
      }
      const cur = await db.query("SELECT gate_sub FROM users WHERE id = $1", [
        userId,
      ]);
      if (cur.rows.length === 0) return "gone";
      return cur.rows[0].gate_sub ? "already_linked" : "gone";
    },
    async setEmailIfFree(userId, email) {
      await db.query(
        `UPDATE users SET email = $2
         WHERE id = $1 AND email <> $2
           AND NOT EXISTS (SELECT 1 FROM users o WHERE o.email = $2 AND o.id <> $1)`,
        [userId, email],
      );
    },
    async createGateUser(u) {
      try {
        const r = await db.query(
          `INSERT INTO users (public_id, username, email, gate_sub, gate_id_token, age_confirmed_at)
           VALUES ($1, $2, $3, $4, $5, now())
           RETURNING ${USER_COLS}`,
          [u.publicId, u.username, u.email, u.gateSub, u.idToken],
        );
        return { ok: true, user: r.rows[0] as UserRow };
      } catch (e) {
        const err = e as { code?: string; constraint?: string };
        if (err.code === "23505") {
          const c = err.constraint ?? "";
          return {
            ok: false,
            taken: c.includes("gate_sub")
              ? "gate"
              : c.includes("email")
                ? "email"
                : "username",
          };
        }
        throw e;
      }
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
