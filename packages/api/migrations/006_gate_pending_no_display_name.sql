-- GATE's display name is gone (it always equalled the login name), so new pending
-- rows leave it empty. The column stays, nullable, for rows written before this.
ALTER TABLE gate_pending ALTER COLUMN display_name DROP NOT NULL;
