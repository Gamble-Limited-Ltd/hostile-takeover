# Authentication & Authorization Flow

## Token Management

1. **Long-lived refresh token**: Stored as an HTTP-only cookie with a 30-day TTL
2. **Token exchange**: User sends refresh token to the API server, receives a short-lived JWT in return, and the refresh token is rotated
3. **JWT properties**:
   - 15-minute TTL (limits damage window if compromised)
   - Contains the persistentID
   - Stored in memory only (lost on page refresh)

## WebSocket Authorization

1. **WebSocket connection**: When user connects, server validates the JWT and creates a `clientID => persistentID` mapping, establishing that this client is authorized to act on behalf of this persistent identity

2. **Post-connection authorization**: Once WebSocket connection is established, no further token verification is needed. For actions like pause requests, simple ownership checks suffice.

## Key Insight

JWT verification happens once at WebSocket connection time. After that, the established mapping allows for lightweight authorization checks based on clientID rather than repeated token validation.

## Development Mode

When running the game in development, the API server is not active, so the game falls back to checking only persistentIDs for verification instead of JWTs. This is less secure, as stealing a persistentID means the attacker has indefinite control of the victim's account.

## Hostile Takeover: Sign in with GLL ID

HT signs players in through **GLL ID** (GATE, Gamble Limited Ltd.'s shared login, `id.taps-holdings.org`) as a
plain OpenID Connect client, then mints its **own** refresh cookie and JWT exactly as above, so the game server and
WebSocket code never see GATE. HT talks to GATE only over standard OIDC/HTTP; no GATE code is in this repo.

- **Flow:** `GET /auth/gate/start` stores state, nonce and a PKCE S256 verifier server-side (`gate_flows`, single use,
  10 min, bound to the browser by the `ht_gate_flow` cookie) and redirects to GATE's authorize endpoint with scope
  `openid profile email`. `GET /auth/gate/callback` consumes the flow, checks the RFC 9207 `iss` parameter, exchanges
  the code with `client_secret_basic`, and verifies the id_token with `jose` (ES256 only, `iss`, `aud`, `exp`, `nonce`,
  `azp`, `email_verified`). Code: `packages/api/src/gate.ts`, `gateRoutes.ts`.
- **Linked player** (`users.gate_sub` = GATE `sub`): signed straight in, back to `#gate=ok`.
- **Not linked yet:** a `gate_pending` row (15 min, `ht_gate_pending` cookie) and `#gate=link`. The account modal then
  offers, in order: "Is this your account X?" when an unlinked HT account has the same email as the GLL ID (one click,
  `POST /auth/gate/link/confirm`); linking an old account by its HT password once (`/auth/gate/link/password`, same
  rate limits as sign-in); or a new account (`/auth/gate/create`) only when GATE says the email is approved: the boolean `email_approved`
  claim (true for `@kmlhs.org` or an owner exception, computed live by GATE) must be exactly `true`. HT reads it from the
  verified id_token, falling back to the userinfo endpoint (bearer access token, `sub` must match), and stores it in
  `gate_pending.email_approved`; the create step reads that stored value, never the request body. A missing, non-boolean
  or false claim (or an unreachable userinfo) refuses with 403 `email_not_approved`. Linking an old account (email match
  or old password) never needs the claim. The legacy `/auth/register` stays `@kmlhs.org` only.
- **Logout:** `/auth/logout` also returns `gateLogoutUrl` (GATE's end-session endpoint with `id_token_hint` from the
  player's latest GLL ID sign-in, `client_id` and `post_logout_redirect_uri`); the client navigates there and GATE sends
  the player back. GATE's force sign-out does **not** end HT sessions (HT sessions are HT's own, up to 30 days).
- **Flags:** `GATE_ISSUER` empty turns GLL ID off (the client shows the password form exactly as before).
  `LEGACY_LOGIN=off` makes `/auth/login` and `/auth/register` answer 403 `legacy_login_disabled`; linking an old account
  by password keeps working. `GET /auth/config` tells the client which to show.
- **Ranks:** HT's own `users.rank` stays the source of root; GATE's `global_rank` is ignored.

### New-tab sign-in

"Sign in with GLL ID" opens `/auth/gate/start?tab=1` in a **new tab** (a blocked popup falls back to this tab). The
start route sets a short `ht_gate_tab` cookie and the callback then redirects to `#gate=ok|link|gate_error=...&tab=1`.
The new tab remembers it is the sign-in tab (`sessionStorage`), runs the existing link/create steps, and when done
shows "You're signed in. You can close this tab." and tries `window.close()`. It also tells the original tab
(`BroadcastChannel`, with a `localStorage` `storage` event as fallback, `src/client/GateTabSignal.ts`); the original
tab reloads, and the normal startup refresh-cookie exchange signs it in.

### "Redirect failed? Sign in here" (direct sign-in)

A link under the GLL ID button opens an HT-styled modal branded "GLL ID" (`GateDirectModal.ts`): sign in, create account,
6-digit email code (with resend) and forgot password. The browser posts to `POST /auth/gate/direct/login|signup|verify|
resend|recover|reset`; HT's server calls GATE's `/oidc/direct/*` (contract: GATE's `docs/DIRECT-SIGNIN.md`) with the
client's Basic credentials and `player_ip`. The password is only forwarded, never stored or logged.

- `login` / `verify`: HT makes a PKCE verifier + S256 challenge and a nonce, sends HT's registered `GATE_REDIRECT_URI`,
  gets `{code}`, then exchanges it at `/oidc/token` through the same `gate.exchange` (id_token checks as the callback)
  and the same `signInWho` as the callback: linked player gets the refresh cookie (`{status:"ok"}`); otherwise a
  `gate_pending` row and `{status:"link"}`, and the account modal's link card runs (email match, old password, or create
  only when `email_approved === true`).
- GATE's `error` (`code`, `message`, `fields`) and any `pending` handle are passed through unchanged, including
  `DIRECT_SIGNIN_DISABLED`. HT's own failures use `HT_*` codes. `signup` fills the Terms/Privacy versions from GATE's
  `/api/legal/versions`.
- Limits: the usual CORS/origin check and 16 kb body limit; only a flood backstop per IP (600/min) because players
  share a school IP. GATE enforces the real limits per account.

### GATE_DIRECT_URL (private path to GATE)

`GATE_DIRECT_URL` (optional, default the issuer) is where HT's server reaches GATE for discovery, JWKS, token and the
direct endpoints; discovered public URLs are rewritten onto it. The id_token `iss` must still equal `GATE_ISSUER`
exactly. Production: `GATE_DIRECT_URL=http://gate:3301` over the external Docker network `gll_gate` (alias `gate`,
declared in `docker-compose.prod.yml`; `ht-deploy.sh` creates it with `--internal` if missing). Dev: `http://127.0.0.1:3302`.
Takes precedence over `GATE_BACKCHANNEL_URL`.
