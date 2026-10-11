ALTER TABLE sessions
  ADD COLUMN last_used_at timestamptz,
  ADD COLUMN user_agent text;
