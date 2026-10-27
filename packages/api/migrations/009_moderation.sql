-- Admin tools: bans, chat mutes, site settings, chat reports, unranked games.
-- banned_until NULL = not banned; 'infinity' = permanent.
ALTER TABLE users ADD COLUMN banned_until timestamptz;
ALTER TABLE users ADD COLUMN ban_reason text;
ALTER TABLE users ADD COLUMN chat_muted_until timestamptz;
ALTER TABLE users ADD COLUMN chat_shadow_muted boolean NOT NULL DEFAULT false;

CREATE TABLE site_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

-- Kept 30 days (purged on insert and list).
CREATE TABLE chat_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id text NOT NULL,
  reporter_id uuid REFERENCES users (id) ON DELETE CASCADE,
  target_id uuid REFERENCES users (id) ON DELETE CASCADE,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_reports_created_idx ON chat_reports (created_at);

ALTER TABLE games ADD COLUMN unranked_reason text;
