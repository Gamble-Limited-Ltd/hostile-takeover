import { randomUUID } from "node:crypto";
import type {
  Credentials,
  SessionRow,
  Store,
} from "../../packages/api/src/store";
import type { UserRow } from "../../packages/api/src/userMe";

export type MemSession = SessionRow & {
  token_hash: string;
  rotated_from?: string;
};

export interface MemResetRow {
  user_id: string;
  token_hash: string;
  created_by: string | null;
  expires_at: Date;
  used_at: Date | null;
}

/** An in-memory Store; `hashes` maps user id to password hash. */
export function memoryStore(
  users: UserRow[],
  hashes: Record<string, string> = {},
) {
  const sessions: MemSession[] = [];
  const resets: MemResetRow[] = [];
  const audit: {
    actor: string;
    action: string;
    target: string | null;
    detail?: Record<string, unknown>;
  }[] = [];
  const lower = (s: string) => s.toLowerCase();
  const store: Store = {
    findUserByUsername: async (n) =>
      users.find((u) => lower(u.username) === lower(n)) ?? null,
    findUserById: async (id) => users.find((u) => u.id === id) ?? null,
    createSession: async (s) => {
      const id = randomUUID();
      sessions.push({
        id,
        user_id: s.userId,
        token_hash: s.tokenHash,
        expires_at: s.expiresAt,
        revoked_at: null,
        rotated_from: s.rotatedFrom,
      });
      return id;
    },
    findSessionByHash: async (h) =>
      sessions.find((s) => s.token_hash === h) ?? null,
    rotateSession: async (id) => {
      const s = sessions.find((x) => x.id === id)!;
      if (s.revoked_at) return false;
      s.revoked_at = new Date();
      return true;
    },
    revokeSession: async (id) => {
      const s = sessions.find((x) => x.id === id)!;
      s.revoked_at ??= new Date();
    },
    revokeAllForUser: async (uid) => {
      for (const s of sessions)
        if (s.user_id === uid) s.revoked_at ??= new Date();
    },
    findSuccessor: async (id) =>
      [...sessions].reverse().find((s) => s.rotated_from === id) ?? null,
    findCredentials: async (login): Promise<Credentials | null> => {
      const u = users.find((x) =>
        login.includes("@")
          ? lower(x.email) === lower(login)
          : lower(x.username) === lower(login),
      );
      return u ? { user: u, passwordHash: hashes[u.id] } : null;
    },
    findPasswordHash: async (id) => hashes[id] ?? null,
    createUser: async (n) => {
      if (users.some((u) => lower(u.username) === lower(n.username)))
        return { ok: false, taken: "username" };
      if (users.some((u) => lower(u.email) === lower(n.email)))
        return { ok: false, taken: "email" };
      const user: UserRow = {
        id: randomUUID(),
        public_id: n.publicId,
        username: n.username,
        first_name: n.firstName,
        last_name: n.lastName,
        email: n.email,
        rank: "PLAYER",
        disabled_at: null,
      };
      users.push(user);
      hashes[user.id] = n.passwordHash;
      return { ok: true, user };
    },
    setPassword: async (id, h) => {
      hashes[id] = h;
    },
    deleteUser: async (id) => {
      users.splice(
        users.findIndex((u) => u.id === id),
        1,
      );
      for (let i = sessions.length - 1; i >= 0; i--)
        if (sessions[i].user_id === id) sessions.splice(i, 1);
    },
    createReset: async (r) => {
      resets.push({
        user_id: r.userId,
        token_hash: r.tokenHash,
        created_by: r.createdBy,
        expires_at: r.expiresAt,
        used_at: null,
      });
    },
    consumeReset: async (h) => {
      const r = resets.find(
        (x) =>
          x.token_hash === h &&
          !x.used_at &&
          x.expires_at.getTime() > Date.now(),
      );
      if (!r) return null;
      for (const x of resets)
        if (x.user_id === r.user_id) x.used_at ??= new Date();
      return r.user_id;
    },
    logAdmin: async (e) => {
      audit.push(e);
    },
  };
  return { store, sessions, resets, audit, users, hashes };
}
