-- GATE's `email_approved` claim, kept with the pending identity so the one-click
-- create step uses the server-verified value. NULL means GATE sent none (fail closed).
ALTER TABLE gate_pending ADD COLUMN email_approved boolean;
