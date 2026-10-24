import {
  HT_LEADERBOARD_MIN_GAMES,
  type HtLeaderboardSort,
} from "@openfront/shared/HtLeaderboardSchemas";
import type { UserRow } from "./userMe";
import type { ProgressState, XpResult } from "./xp/rules";

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

  /**
   * Stores a finished game, its account players and their XP in ONE
   * transaction. Idempotent: a known game id changes nothing and returns
   * false. `award` runs per account player (ids with no account are dropped)
   * with that player's progress row, locked, and returns what to store.
   */
  recordGame(
    game: GameRow,
    players: GamePlayerRow[],
    award: (p: GamePlayerRow, progress: ProgressRow) => AwardOutcome,
  ): Promise<boolean>;

  /**
   * Renames a user. `cooldownMs` null skips the limit (root). Self-service
   * renames stamp username_changed_at; root renames leave it alone.
   */
  renameUser(
    userId: string,
    username: string,
    opts: { cooldownMs: number | null },
  ): Promise<RenameResult>;
  /** The account's saved flag ref (`country:<code>`), null when none. */
  /**
   * One page of the public player leaderboard (U2.5). Disabled accounts are
   * out; wins and games count every bucket. Ties break on username, then id.
   */
  listLeaderboard(
    sort: HtLeaderboardSort,
    limit: number,
    offset: number,
  ): Promise<LeaderboardRow[]>;
  getFlag(userId: string): Promise<string | null>;
  setFlag(userId: string, flag: string | null): Promise<void>;
  /** The account's progress, level 1 / 0 XP when it has no row yet. */
  getProgress(userId: string): Promise<ProgressState>;
  /** Admin XP fix: upserts the row; `clearDay` also nulls last_xp_day. */
  setProgress(
    userId: string,
    state: ProgressState,
    clearDay: boolean,
  ): Promise<void>;
  /** How many stored games the account played. */
  countGames(userId: string): Promise<number>;
  /** The caller's stored award for the first of `gameIds` that has one. */
  getXpAward(gameIds: string[], userId: string): Promise<StoredAward | null>;
  /** Public profile data; null for an unknown or disabled account. */
  getProfile(publicId: string): Promise<ProfileData | null>;

  logAdmin(entry: {
    actor: string;
    action: string;
    target: string | null;
    detail?: Record<string, unknown>;
  }): Promise<void>;
}

export interface GameRow {
  /** 'sp:<gameID>' for singleplayer, the game id otherwise. */
  id: string;
  source: "server" | "singleplayer";
  modeBucket: "singleplayer" | "public" | "private";
  gameType: string;
  gameMode: string;
  map: string;
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  winner: unknown;
}

export interface GamePlayerRow {
  userId: string;
  placement: number;
  won: boolean;
  timeAliveMs: number;
  leftEarly: boolean;
  mostTerritory: boolean;
  eliminatedPlayer: boolean;
  survived: boolean;
}

export interface ProgressRow {
  state: ProgressState;
  /** America/Chicago calendar day (YYYY-MM-DD) of the last eligible award. */
  lastXpDay: string | null;
}

export interface AwardOutcome {
  result: XpResult;
  rulesVersion: number;
  before: ProgressState;
  after: ProgressState;
  levelsReached: number[];
  lastXpDay: string | null;
}

export interface StoredAward {
  gameId: string;
  /** The stored XpResult: a breakdown, or an ineligible reason. */
  result: XpResult;
  before: ProgressState;
  after: ProgressState;
  levelsReached: number[];
}

export interface LeaderboardRow {
  publicId: string;
  username: string;
  flag: string | null;
  progress: ProgressState;
  games: number;
  wins: number;
}

export interface ProfileData {
  userId: string;
  username: string;
  createdAt: Date;
  flag: string | null;
  progress: ProgressState;
  /** Wins and games per (mode bucket, game mode). */
  buckets: { bucket: string; gameMode: string; games: number; wins: number }[];
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

export type RenameResult =
  | { ok: true; user: UserRow }
  | { ok: false; taken: true }
  | { ok: false; taken: false; retryAt: Date };

export type CreateGateUserResult =
  | { ok: true; user: UserRow }
  | { ok: false; taken: "username" | "email" | "gate" };

export interface SqlClient {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, any>[] }>;
  /** Present on a pool: a transaction needs one connection. */
  connect?(): Promise<{
    query: SqlClient["query"];
    release(): void;
  }>;
}

const USER_COLS =
  "id, public_id, username::text AS username, first_name, last_name, email::text AS email, rank, disabled_at, gate_sub, username_changed_at";

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
    async recordGame(game, players, award) {
      const conn = db.connect ? await db.connect() : null;
      const q: SqlClient = conn ?? db;
      try {
        await q.query("BEGIN");
        const ins = await q.query(
          `INSERT INTO games (id, source, mode_bucket, game_type, game_mode, map, started_at, ended_at, duration_ms, winner)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO NOTHING RETURNING id`,
          [
            game.id,
            game.source,
            game.modeBucket,
            game.gameType,
            game.gameMode,
            game.map,
            game.startedAt,
            game.endedAt,
            game.durationMs,
            JSON.stringify(game.winner ?? null),
          ],
        );
        if (ins.rows.length === 0) {
          await q.query("ROLLBACK");
          return false;
        }
        const known = await q.query(
          "SELECT id FROM users WHERE id = ANY($1::uuid[])",
          [players.map((p) => p.userId)],
        );
        const ids = new Set(known.rows.map((r) => r.id as string));
        const seen = new Set<string>();
        // Sorted by user id so two games finishing together lock rows in one order.
        const mine = players
          .filter(
            (p) =>
              ids.has(p.userId) && !seen.has(p.userId) && seen.add(p.userId),
          )
          .sort((a, b) => (a.userId < b.userId ? -1 : 1));
        for (const p of mine) {
          await q.query(
            `INSERT INTO game_players (game_id, user_id, placement, won, time_alive_ms, left_early, most_territory, eliminated_player, survived)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              game.id,
              p.userId,
              p.placement,
              p.won,
              p.timeAliveMs,
              p.leftEarly,
              p.mostTerritory,
              p.eliminatedPlayer,
              p.survived,
            ],
          );
          await q.query(
            "INSERT INTO user_progress (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
            [p.userId],
          );
          const cur = (
            await q.query(
              `SELECT level, xp_in_level, lifetime_xp, to_char(last_xp_day, 'YYYY-MM-DD') AS last_xp_day
               FROM user_progress WHERE user_id = $1 FOR UPDATE`,
              [p.userId],
            )
          ).rows[0];
          const o = award(p, {
            state: {
              prestige: 0,
              level: cur.level,
              xpInLevel: cur.xp_in_level,
              lifetimeXp: Number(cur.lifetime_xp),
            },
            lastXpDay: cur.last_xp_day,
          });
          await q.query(
            `UPDATE user_progress SET level = $2, xp_in_level = $3, lifetime_xp = $4, last_xp_day = $5 WHERE user_id = $1`,
            [
              p.userId,
              o.after.level,
              o.after.xpInLevel,
              o.after.lifetimeXp,
              o.lastXpDay,
            ],
          );
          await q.query(
            `INSERT INTO xp_awards (game_id, user_id, rules_version, breakdown, before, after, levels_reached)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              game.id,
              p.userId,
              o.rulesVersion,
              JSON.stringify(o.result),
              JSON.stringify(o.before),
              JSON.stringify(o.after),
              o.levelsReached,
            ],
          );
        }
        await q.query("COMMIT");
        return true;
      } catch (e) {
        await q.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        conn?.release();
      }
    },
    async getProgress(userId) {
      const r = await db.query(
        "SELECT level, xp_in_level, lifetime_xp FROM user_progress WHERE user_id = $1",
        [userId],
      );
      const row = r.rows[0];
      return {
        prestige: 0,
        level: row?.level ?? 1,
        xpInLevel: row?.xp_in_level ?? 0,
        lifetimeXp: Number(row?.lifetime_xp ?? 0),
      };
    },
    async setProgress(userId, s, clearDay) {
      await db.query(
        `INSERT INTO user_progress (user_id, level, xp_in_level, lifetime_xp)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET level = $2, xp_in_level = $3, lifetime_xp = $4,
           last_xp_day = CASE WHEN $5 THEN NULL ELSE user_progress.last_xp_day END`,
        [userId, s.level, s.xpInLevel, s.lifetimeXp, clearDay],
      );
    },
    async countGames(userId) {
      const r = await db.query(
        "SELECT count(*)::int AS n FROM game_players WHERE user_id = $1",
        [userId],
      );
      return r.rows[0].n;
    },
    async getXpAward(gameIds, userId) {
      const r = await db.query(
        `SELECT game_id, breakdown, before, after, levels_reached FROM xp_awards
         WHERE user_id = $1 AND game_id = ANY($2::text[]) LIMIT 1`,
        [userId, gameIds],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        gameId: row.game_id,
        result: row.breakdown,
        before: row.before,
        after: row.after,
        levelsReached: row.levels_reached,
      };
    },
    async getProfile(publicId) {
      const u = await db.query(
        `SELECT id, username::text AS username, created_at, flag FROM users
         WHERE public_id = $1 AND disabled_at IS NULL`,
        [publicId],
      );
      const user = u.rows[0];
      if (!user) return null;
      const b = await db.query(
        `SELECT g.mode_bucket, g.game_mode, count(*)::int AS games,
                count(*) FILTER (WHERE gp.won)::int AS wins
         FROM game_players gp JOIN games g ON g.id = gp.game_id
         WHERE gp.user_id = $1 GROUP BY g.mode_bucket, g.game_mode`,
        [user.id],
      );
      return {
        userId: user.id,
        username: user.username,
        createdAt: user.created_at,
        flag: user.flag,
        progress: await this.getProgress(user.id),
        buckets: b.rows.map((r) => ({
          bucket: r.mode_bucket,
          gameMode: r.game_mode,
          games: r.games,
          wins: r.wins,
        })),
      };
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
    async renameUser(userId, username, opts) {
      try {
        const r = await db.query(
          `UPDATE users
              SET username = $2,
                  username_changed_at = CASE WHEN $3::bigint IS NULL
                                             THEN username_changed_at ELSE now() END
            WHERE id = $1
              AND ($3::bigint IS NULL OR username_changed_at IS NULL
                   OR username_changed_at <= now() - ($3::bigint * interval '1 millisecond'))
            RETURNING ${USER_COLS}`,
          [userId, username, opts.cooldownMs],
        );
        if (r.rows[0]) return { ok: true, user: r.rows[0] as UserRow };
        const cur = await db.query(
          "SELECT username_changed_at FROM users WHERE id = $1",
          [userId],
        );
        const at = cur.rows[0]?.username_changed_at as Date | undefined;
        return {
          ok: false,
          taken: false,
          retryAt: new Date(
            (at?.getTime() ?? Date.now()) + (opts.cooldownMs ?? 0),
          ),
        };
      } catch (e) {
        if ((e as { code?: string }).code === "23505")
          return { ok: false, taken: true };
        throw e;
      }
    },
    async listLeaderboard(sort, limit, offset) {
      const where = {
        xp: "p.user_id IS NOT NULL",
        wins: "COALESCE(s.games, 0) > 0",
        games: "COALESCE(s.games, 0) > 0",
        winrate: `COALESCE(s.games, 0) >= ${HT_LEADERBOARD_MIN_GAMES}`,
      }[sort];
      const order = {
        xp: "COALESCE(p.lifetime_xp, 0) DESC",
        wins: "COALESCE(s.wins, 0) DESC",
        games: "COALESCE(s.games, 0) DESC",
        winrate: "COALESCE(s.wins, 0)::float / COALESCE(s.games, 1) DESC",
      }[sort];
      const r = await db.query(
        `SELECT u.public_id, u.username::text AS username, u.flag,
                COALESCE(p.level, 1) AS level, COALESCE(p.xp_in_level, 0) AS xp_in_level,
                COALESCE(p.lifetime_xp, 0)::float8 AS lifetime_xp,
                COALESCE(s.games, 0) AS games, COALESCE(s.wins, 0) AS wins
         FROM users u
         LEFT JOIN user_progress p ON p.user_id = u.id
         LEFT JOIN (SELECT user_id, count(*)::int AS games,
                           count(*) FILTER (WHERE won)::int AS wins
                    FROM game_players GROUP BY user_id) s ON s.user_id = u.id
         WHERE u.disabled_at IS NULL AND ${where}
         ORDER BY ${order}, lower(u.username::text), u.public_id
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
      return r.rows.map((x) => ({
        publicId: x.public_id,
        username: x.username,
        flag: x.flag,
        progress: {
          prestige: 0 as const,
          level: x.level,
          xpInLevel: x.xp_in_level,
          lifetimeXp: x.lifetime_xp,
        },
        games: x.games,
        wins: x.wins,
      }));
    },
    async getFlag(userId) {
      const r = await db.query("SELECT flag FROM users WHERE id = $1", [
        userId,
      ]);
      return r.rows[0]?.flag ?? null;
    },
    async setFlag(userId, flag) {
      await db.query("UPDATE users SET flag = $2 WHERE id = $1", [
        userId,
        flag,
      ]);
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
