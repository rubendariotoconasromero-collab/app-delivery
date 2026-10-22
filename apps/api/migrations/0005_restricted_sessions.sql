-- Preserve only scoped access to an existing service after an account suspension.
-- Restricted credentials never regain ordinary permissions on reactivation.
ALTER TABLE auth_sessions ADD COLUMN restricted BOOLEAN NOT NULL DEFAULT FALSE;
