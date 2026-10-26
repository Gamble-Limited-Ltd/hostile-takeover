-- GATE id_tokens are no longer stored (logout sends no id_token_hint). Wipe the
-- ones written before; the columns stay, unused, so a rollback still runs.
UPDATE users SET gate_id_token = NULL WHERE gate_id_token IS NOT NULL;
UPDATE gate_pending SET id_token = NULL WHERE id_token IS NOT NULL;
