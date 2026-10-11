# Stage 2 — Accounts

**Goal:** friends can create an account, log in, stay logged in, log out and delete their
account. The owner can reset a password. The new screens follow the **STRICT UI rules** in `CLAUDE.md`.

**Exit test:** a new `@kmlhs.org` user signs up from the nav "Sign in" button, plays a game, reloads
the page (still signed in), logs out and logs back in. `thestrongest` resets that user's password,
and the user logs in with the new one.

Slice 2.1 comes first. Slices 2.2 and 2.3 can run in parallel after it (one is API, one is client), and 2.4 comes last.

---

## Slice 2.1 — Account API (Sonnet)

- `POST /auth/register` `{ firstName, lastName, email, username, password, ageConfirmed }`:
  - The email must match `/^[^@\s]+@kmlhs\.org$/i`. It is **not verified**, and the server never sends an email.
  - `ageConfirmed` must be `true` (the 13+ checkbox). Store the timestamp.
  - Usernames follow the client's existing username rules (`src/client/validations/username.ts`)
    plus the server `Censor`. They're unique and case-insensitive.
  - Password: at least 10 characters, hashed with argon2id.
  - On success, create a session and set the refresh cookie. The client then does the usual refresh.
- `POST /auth/login` `{ usernameOrEmail, password }`: the same cookie result. Return one generic
  error message for every failure.
- Rate limits (in memory is enough): login and register per IP and per account.
- `DELETE /users/@me`: delete the account and its sessions. Match what the client's
  `ApiDeleteAccount` already calls (read those tests).
- `POST /admin/password-resets` (JWT `role: root` only) `{ username }` → a one-time token that lasts
  24 hours. `POST /auth/reset` `{ token, newPassword }` uses it and revokes every session.
  Also add a CLI (`npm run api:admin -- reset <username>`) that prints a reset link.
- Every admin action is logged (`admin_audit` table: who, what, target, when). Add it as the next migration (`003`; `002` is taken by Slice 1.3).
- **Refresh grace window (from Slice 1.3):** today two tabs refreshing at the same moment look like
  token reuse and log the user out everywhere. Accept a just-rotated token for about 30 seconds
  after its rotation, returning the current successor session's new token instead of revoking the chain.
  Reuse outside that window still revokes the chain. Add a test.
- **`usernameStatus`** is left out of `/users/@me` on purpose, which keeps the custom-username UI off.
  Username changes stay out of v1, so keep it that way.
- Tests for each route, including the failure cases.

### Slice 2.1 as built (read this before 2.2 / 2.3 / 2.4)

All JSON. Errors are `{ "error": "<code>" }`. State-changing routes refuse a foreign `Origin` (403).

| Route                                                                             | Success                                                                                      | Error codes                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/register` `{firstName,lastName,email,username,password,ageConfirmed}` | 201 `{ok,userId}` + refresh cookie, then the client does its usual `/auth/refresh`           | 400 `first_name_invalid`, `last_name_invalid`, `email_domain` (not `@kmlhs.org`), `username_invalid` (3-20 chars of `a-zA-Z0-9_-`, single inner spaces), `username_censored`, `password_too_short` (<10), `password_too_long` (>128), `age_unconfirmed`, `invalid_request` (bad JSON); 409 `username_taken`, `email_taken`; 429 `rate_limited` |
| `POST /auth/login` `{usernameOrEmail,password}`                                   | 200 `{ok,userId}` + cookie                                                                   | 401 `invalid_credentials` for every failure (wrong password, unknown user, disabled); 429 `rate_limited`                                                                                                                                                                                                                                       |
| `DELETE /users/@me`                                                               | 204, cookie cleared, user and sessions deleted immediately (no 24h delay)                    | 401 `unauthorized`                                                                                                                                                                                                                                                                                                                             |
| `PATCH /users/@me/password` `{currentPassword,newPassword}` (Bearer JWT)          | 200 `{ok}`                                                                                   | 401 `unauthorized`; 403 `wrong_password`; 400 `password_too_short`/`password_too_long`; 429                                                                                                                                                                                                                                                    |
| `POST /admin/password-resets` `{username}` (Bearer JWT, role root)                | 201 `{token,link,expiresAt}`                                                                 | 401; 403 `forbidden`; 404 `no_such_user`                                                                                                                                                                                                                                                                                                       |
| `POST /auth/reset` `{token,newPassword}`                                          | 200 `{ok}`; every session revoked; **no** cookie is set, so the UI sends the user to sign in | 400 `invalid_token` (unknown, expired or used), `password_too_short`/`_long`; 429                                                                                                                                                                                                                                                              |

- **Delete** is authenticated by the refresh cookie alone (that is what `deleteAccount()` in `src/client/Api.ts` sends: `credentials: "include"`, no `Authorization`). A Bearer JWT also works. After a 204 the client must not call `/auth/logout`.
- **Change password** signs out every other session and issues the caller a fresh session cookie, so they stay signed in. The current JWT stays valid until it expires.
- **Reset link format:** `${GAME_ORIGIN}/#reset=<token>` (token is 43 base64url chars). Slice 2.2 reads `location.hash` for `reset=`, shows a "new password" form and calls `POST /auth/reset`, then clears the hash. Tokens last 24h, are single use, stored as SHA-256,; redeeming one voids the user's other open tokens.
- **Temporary password** option from the decisions is not built; the link covers it.
- **CLI:** `npm run api:admin -- reset <username>` prints the link (audited as actor `cli`). Every admin action writes `admin_audit` (`actor` username or `cli`, `action`, `target` username, `detail` jsonb, `created_at`); migration `003_admin_audit.sql`.
- **Rate limits** (in memory, per process; IP from `X-Forwarded-For` only when the proxy is loopback): login 30/15 min per IP and 10 failures/15 min per account (cleared on success); register 10/h per IP and 5/h per username; reset 20/15 min per IP; password change 10 failures/15 min per user.
- **Refresh grace:** a rotated token is accepted for 30 s (`REFRESH_GRACE_MS`) after rotation; the server rotates the live successor and sets a new cookie. Older reuse still revokes everything.
- `usernameStatus` stays out of `/users/@me`.

## Slice 2.2 — Sign-in and sign-up modal (Sonnet, UI)

Read the STRICT UI rules first. Base it on the **existing** login modal (`AccountModal.ts` and its
magic-link email form, and `TokenLoginModal.ts`), not on new markup.

- Replace the provider buttons and the magic-link form in the signed-out account modal with:
  - A **Sign in** form: username or email, and password.
  - A **Create account** form: first name, last name, email (with the hint "@kmlhs.org"), username,
    password, and a checkbox reading "I'm 13 or older and agree to the Terms and Privacy Policy".
  - A link that switches between the two, in the same style as the modal's existing links.
- Use only existing inputs, buttons, spacing and colours. All text goes in `en.json`.
- Keep the existing lazy-load rules (`LazyModals.ts`, `whenModalLoaded`).
- After success, run the existing post-login path (whatever magic-link / token login triggers) so
  the nav button, `/users/@me` and the rest update the same way they do today.
- Screenshots: the old signed-out modal next to the new Sign in and Create account views, on
  desktop and mobile widths.

## Slice 2.3 — Account panel cleanup (Sonnet, UI)

- The signed-in account panel shows the username, the email, **Change password** (current + new)
  and **Delete account** (the existing `DeleteAccountDialog`). Hide the provider linking,
  Steam, CrazyGames, subscription, currency and creator-code sections. Hide them, don't redesign the panel.
- `PATCH /users/@me/password` on the API (Slice 2.1 adds it if it isn't there yet).

## Slice 2.4 — Admin reset screen (Sonnet; can come last or be skipped)

- Only visible when the JWT role is `root`: a small section in the account panel with a username
  field and a "Create reset link" button that shows the link with the existing `CopyButton`.
  The CLI from 2.1 is enough if this slips.

## From Slice 1.5

- When signed in, the in-game and lobby name is still the random "AnonXxxN", not the account username.
  The home page's name box ("Use verified" plus the TAG clan field) still shows. Signed-in players should
  play as their username. Find how the client picks the name for verified users (`UsernameInput`,
  `usernameStatus`) and make it use `users.username`. Hide the TAG field with clans.

**Approval:** run through the exit test live, plus the screenshot pairs.
