import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// The repo root .env, wherever the process was started from.
dotenv.config({
  path: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../.env",
  ),
  quiet: true,
});

export interface ApiEnv {
  apiPort: number;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  migrateOnBoot: boolean;
  /** This API's own public origin; must equal the game server's jwtIssuer(). */
  apiUrl: string;
  /** The JWT audience (the game's DOMAIN). */
  domain: string;
  /** The one browser origin allowed by CORS. */
  gameOrigin: string;
  /** Extra browser origins allowed by CORS (LAN dev mode); empty by default. */
  extraOrigins: string[];
  /** Interface the API binds to; loopback unless API_HOST says otherwise. */
  apiHost: string;
  /** Path to the PKCS8 PEM holding the Ed25519 signing key. */
  jwtPrivateKeyFile: string;
  /** Shared secret the game server sends as x-api-key. */
  apiKey: string;
  /** Public host[:port] of the one game server (no scheme), served as cluster.json's `a`. */
  gameHost: string;
  /** The commit-like version cluster.json reports for it; clients on a hex build must match. */
  gameVersion: string;
  nodeEnv: string;
  /**
   * Express `trust proxy` setting: which peers may set X-Forwarded-For.
   * Loopback by default; production behind Docker also trusts the bridge
   * network's private range (the tunnel reaches us from the bridge gateway).
   */
  trustProxy: string;
  /** GLL ID (GATE) OIDC issuer; "" turns "Sign in with GLL ID" off. */
  gateIssuer: string;
  gateClientId: string;
  gateClientSecret: string;
  gateRedirectUri: string;
  gatePostLogoutUri: string;
  /** Origin used instead of the issuer's for server-to-server fetches; "" = none. */
  gateBackchannelUrl: string;
  /**
   * Origin for server-to-server calls to GATE (discovery, JWKS, token and the
   * direct sign-in endpoints), e.g. a private Docker address. "" = the issuer.
   * The id_token `iss` must still equal `gateIssuer`.
   */
  gateDirectUrl: string;
  /** Whether username/password sign-in and sign-up are still allowed. */
  legacyLogin: boolean;
}

/** The repo root, wherever the process was started from. */
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
export const DEFAULT_KEY_FILE = path.join(
  REPO_ROOT,
  "packages/api/.keys/jwt-ed25519.pem",
);

function str(value: string | undefined, fallback: string): string {
  return value === undefined || value === "" ? fallback : value;
}

function int(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Expected a positive integer, got "${value}"`);
  }
  return n;
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const apiUrl = str(source.API_URL, "http://localhost:8787").replace(
    /\/+$/,
    "",
  );
  const gameOrigin = str(source.GAME_ORIGIN, "http://localhost:5178").replace(
    /\/+$/,
    "",
  );
  return {
    apiPort: int(source.API_PORT, 8787),
    dbHost: str(source.HT_DB_HOST, "127.0.0.1"),
    dbPort: int(source.HT_DB_PORT, 5436),
    dbName: str(source.HT_DB_NAME, "hostile_takeover"),
    dbUser: str(source.HT_DB_USER, "hostile_takeover"),
    dbPassword: source.HT_DB_PASSWORD ?? "",
    migrateOnBoot: source.HT_DB_MIGRATE_ON_BOOT === "true",
    apiUrl,
    domain: str(source.DOMAIN, "localhost"),
    gameOrigin,
    extraOrigins: str(source.EXTRA_GAME_ORIGINS, "")
      .split(",")
      .map((o) => o.trim().replace(/\/+$/, ""))
      .filter((o) => o !== ""),
    apiHost: str(source.API_HOST, "127.0.0.1"),
    jwtPrivateKeyFile: path.resolve(
      REPO_ROOT,
      str(source.HT_JWT_PRIVATE_KEY_FILE, DEFAULT_KEY_FILE),
    ),
    apiKey: source.API_KEY ?? "",
    // host[:port] of the one game server, as cluster.json reports it. A
    // loopback host (localhost, 127.0.0.1, ::1) means local dev: cluster.json
    // answers 404 there so the client uses the page's own origin (see
    // isLoopbackHost).
    gameHost: str(source.HT_GAME_HOST, "localhost:3400"),
    gameVersion: str(source.HT_GAME_VERSION, "0000000"),
    nodeEnv: source.NODE_ENV ?? "",
    trustProxy: str(source.HT_TRUST_PROXY, "loopback"),
    gateIssuer: str(source.GATE_ISSUER, "").replace(/\/+$/, ""),
    gateClientId: str(source.GATE_CLIENT_ID, ""),
    gateClientSecret: str(source.GATE_CLIENT_SECRET, ""),
    gateRedirectUri: str(
      source.GATE_REDIRECT_URI,
      `${apiUrl}/auth/gate/callback`,
    ),
    gatePostLogoutUri: str(source.GATE_POST_LOGOUT_URI, `${gameOrigin}/`),
    gateBackchannelUrl: str(source.GATE_BACKCHANNEL_URL, "").replace(
      /\/+$/,
      "",
    ),
    gateDirectUrl: str(source.GATE_DIRECT_URL, "").replace(/\/+$/, ""),
    legacyLogin: str(source.LEGACY_LOGIN, "on").toLowerCase() !== "off",
  };
}

/**
 * Whether a `host[:port]` string names this machine. The client builds
 * wss:// and https:// URLs from every cluster.json host, which cannot work
 * against a local dev server without TLS, so cluster.json is not served for
 * a loopback game host.
 */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  // "[::1]:3400" / "[::1]", a bare "::1", else drop an optional ":port".
  const name = h.startsWith("[")
    ? h.slice(1, h.indexOf("]"))
    : h.includes(":") && h.indexOf(":") === h.lastIndexOf(":")
      ? h.slice(0, h.indexOf(":"))
      : h;
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}
