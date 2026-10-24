import { randomUUID } from "node:crypto";
import type {
  AwardOutcome,
  Credentials,
  GamePlayerRow,
  GameRow,
  ProgressRow,
  GatePendingRow,
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

export interface MemGateFlow {
  stateHash: string;
  bindingHash: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: Date;
  usedAt: Date | null;
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
  const flows: MemGateFlow[] = [];
  /** users.gate_id_token, kept off UserRow like the real store. */
  const gateTokens = new Map<string, string>();
  const pending: (GatePendingRow & { tokenHash: string; expiresAt: Date })[] =
    [];
  const games: (GameRow & { players: GamePlayerRow[] })[] = [];
  const progress = new Map<string, ProgressRow>();
  const awards: (AwardOutcome & { gameId: string; userId: string })[] = [];
  const lower = (s: string) => s.toLowerCase();
  const emailFree = (email: string, exceptId: string) =>
    !users.some((u) => u.id !== exceptId && lower(u.email) === lower(email));
  const store: Store = {
    findUserByUsername: async (n) =>
      users.find((u) => lower(u.username) === lower(n)) ?? null,
    findUserById: async (id) => users.find((u) => u.id === id) ?? null,
    findUserByEmail: async (e) =>
      users.find((u) => lower(u.email) === lower(e)) ?? null,
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
        gate_sub: null,
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
      // What ON DELETE CASCADE does in Postgres.
      progress.delete(id);
      for (const g of games)
        g.players = g.players.filter((p) => p.userId !== id);
      for (let i = awards.length - 1; i >= 0; i--)
        if (awards[i].userId === id) awards.splice(i, 1);
    },
    recordGame: async (game, players, award) => {
      if (games.some((g) => g.id === game.id)) return false;
      const seen = new Set<string>();
      const mine = players.filter(
        (p) =>
          users.some((u) => u.id === p.userId) &&
          !seen.has(p.userId) &&
          seen.add(p.userId),
      );
      games.push({ ...game, players: mine });
      for (const p of mine) {
        const cur = progress.get(p.userId) ?? {
          state: { prestige: 0, level: 1, xpInLevel: 0, lifetimeXp: 0 },
          lastXpDay: null,
        };
        const o = award(p, cur);
        progress.set(p.userId, { state: o.after, lastXpDay: o.lastXpDay });
        awards.push({ ...o, gameId: game.id, userId: p.userId });
      }
      return true;
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
    findUserByGateSub: async (sub) =>
      users.find((u) => u.gate_sub === sub) ?? null,
    createGateFlow: async (f) => {
      flows.push({ ...f, usedAt: null });
    },
    consumeGateFlow: async (stateHash, bindingHash) => {
      const f = flows.find(
        (x) =>
          x.stateHash === stateHash &&
          x.bindingHash === bindingHash &&
          !x.usedAt &&
          x.expiresAt.getTime() > Date.now(),
      );
      if (!f) return null;
      f.usedAt = new Date();
      return { nonce: f.nonce, codeVerifier: f.codeVerifier };
    },
    createGatePending: async (p) => {
      pending.push(p);
    },
    findGatePending: async (h) => {
      const p = pending.find(
        (x) => x.tokenHash === h && x.expiresAt.getTime() > Date.now(),
      );
      return p
        ? {
            gateSub: p.gateSub,
            email: p.email,
            loginName: p.loginName,
            emailApproved: p.emailApproved,
            idToken: p.idToken,
          }
        : null;
    },
    deleteGatePending: async (h) => {
      const i = pending.findIndex((x) => x.tokenHash === h);
      if (i >= 0) pending.splice(i, 1);
    },
    findGateIdToken: async (userId) => gateTokens.get(userId) ?? null,
    setGateIdToken: async (userId, idToken) => {
      gateTokens.set(userId, idToken);
    },
    linkGate: async (userId, sub, email, idToken) => {
      const u = users.find((x) => x.id === userId);
      if (!u) return "gone";
      if (u.gate_sub) return "already_linked";
      if (u.disabled_at) return "gone";
      if (users.some((x) => x.gate_sub === sub)) return "already_linked";
      u.gate_sub = sub;
      if (idToken) gateTokens.set(u.id, idToken);
      if (email && emailFree(email, u.id)) u.email = email;
      return "ok";
    },
    setEmailIfFree: async (userId, email) => {
      const u = users.find((x) => x.id === userId);
      if (u && emailFree(email, u.id)) u.email = email;
    },
    createGateUser: async (n) => {
      if (users.some((u) => lower(u.username) === lower(n.username)))
        return { ok: false, taken: "username" };
      if (users.some((u) => lower(u.email) === lower(n.email)))
        return { ok: false, taken: "email" };
      if (users.some((u) => u.gate_sub === n.gateSub))
        return { ok: false, taken: "gate" };
      const user: UserRow = {
        id: randomUUID(),
        public_id: n.publicId,
        username: n.username,
        first_name: null,
        last_name: null,
        email: n.email,
        rank: "PLAYER",
        disabled_at: null,
        gate_sub: n.gateSub,
      };
      users.push(user);
      if (n.idToken) gateTokens.set(user.id, n.idToken);
      return { ok: true, user };
    },
    logAdmin: async (e) => {
      audit.push(e);
    },
  };
  return {
    store,
    sessions,
    resets,
    audit,
    users,
    hashes,
    flows,
    pending,
    games,
    progress,
    awards,
  };
}
