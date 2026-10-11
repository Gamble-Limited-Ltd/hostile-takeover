-- Who did what to whom. actor/target are names (not foreign keys) so the log
-- survives account deletion; the CLI logs as actor 'cli'.
CREATE TABLE admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor text NOT NULL,
  action text NOT NULL,
  target text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created_at_idx ON admin_audit (created_at);
