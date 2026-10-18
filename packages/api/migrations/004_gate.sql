-- Sign in with GLL ID (GATE). An account may be linked to one GATE subject.
-- Accounts created through GATE have no password and no first/last name.
ALTER TABLE users ADD COLUMN gate_sub text UNIQUE;
-- The player's latest GATE id_token, kept only to send back as `id_token_hint`
-- on logout (GATE does not check its exp). Never selected into USER_COLS.
ALTER TABLE users ADD COLUMN gate_id_token text;
ALTER TABLE users ALTER COLUMN first_name DROP NOT NULL;
ALTER TABLE users ALTER COLUMN last_name DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- One row per started sign-in: single use, short lived. Keyed by sha256(state);
-- binding_hash is sha256 of the random value in the browser's ht_gate_flow cookie.
CREATE TABLE gate_flows (
  state_hash text PRIMARY KEY,
  binding_hash text NOT NULL,
  nonce text NOT NULL,
  code_verifier text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX gate_flows_expires_at_idx ON gate_flows (expires_at);

-- A verified GATE identity with no HT account yet, waiting for the player to
-- link or create one. Keyed by sha256 of the ht_gate_pending cookie value.
CREATE TABLE gate_pending (
  token_hash text PRIMARY KEY,
  gate_sub text NOT NULL,
  email text,
  login_name text NOT NULL,
  display_name text NOT NULL,
  id_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX gate_pending_expires_at_idx ON gate_pending (expires_at);
