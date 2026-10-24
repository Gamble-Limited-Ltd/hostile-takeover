-- Update 2: finished games, per-account progress and XP awards.
-- Singleplayer games are stored under the id 'sp:<gameID>' so a client can
-- never claim the id of a server game.
CREATE TABLE games (
  id text PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('server', 'singleplayer')),
  mode_bucket text NOT NULL CHECK (mode_bucket IN ('singleplayer', 'public', 'private')),
  game_type text NOT NULL,
  game_mode text NOT NULL,
  map text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  duration_ms bigint NOT NULL,
  winner jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE game_players (
  game_id text NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  placement int NOT NULL,
  won boolean NOT NULL,
  time_alive_ms bigint NOT NULL,
  left_early boolean NOT NULL,
  most_territory boolean NOT NULL,
  eliminated_player boolean NOT NULL,
  survived boolean NOT NULL,
  PRIMARY KEY (game_id, user_id)
);
CREATE INDEX game_players_user_idx ON game_players (user_id);

CREATE TABLE user_progress (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  prestige int NOT NULL DEFAULT 0,
  level int NOT NULL DEFAULT 1,
  xp_in_level int NOT NULL DEFAULT 0,
  lifetime_xp bigint NOT NULL DEFAULT 0,
  last_xp_day date
);
CREATE INDEX user_progress_lifetime_xp_idx ON user_progress (lifetime_xp DESC);

CREATE TABLE xp_awards (
  game_id text NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rules_version int NOT NULL,
  breakdown jsonb NOT NULL,
  before jsonb NOT NULL,
  after jsonb NOT NULL,
  levels_reached int[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, user_id)
);
CREATE INDEX xp_awards_user_idx ON xp_awards (user_id, created_at DESC);

ALTER TABLE users ADD COLUMN flag text;
ALTER TABLE users ADD COLUMN username_changed_at timestamptz;
