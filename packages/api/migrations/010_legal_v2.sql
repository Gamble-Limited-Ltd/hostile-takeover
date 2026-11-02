-- Legal v2 (dark launch): the terms + privacy version an account accepted, and when.
-- Additive and nullable: nothing reads or writes these while LEGAL_VERSION is unset.
ALTER TABLE users ADD COLUMN IF NOT EXISTS legal_version text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS legal_accepted_at timestamptz;
-- The GATE id_token's legal_version, kept on a pending identity until it links or creates an account.
ALTER TABLE gate_pending ADD COLUMN IF NOT EXISTS legal_version text;
