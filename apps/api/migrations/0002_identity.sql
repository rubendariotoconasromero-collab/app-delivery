CREATE TABLE app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) UNIQUE,
  email VARCHAR(254) UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  password_hash TEXT,
  totp_secret_cipher TEXT,
  last_totp_step BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

CREATE TABLE app_user_roles (
  user_id UUID NOT NULL REFERENCES app_users(id),
  role TEXT NOT NULL CHECK (role IN ('client','driver','operator','finance','admin')),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE auth_otp_challenges (
  id UUID PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register','login','recover')),
  role TEXT NOT NULL CHECK (role IN ('client','driver')),
  display_name VARCHAR(100),
  code_hash TEXT NOT NULL,
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX auth_otp_phone_created ON auth_otp_challenges(phone, created_at DESC);

CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id),
  token_hash CHAR(64) NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('mobile','admin')),
  mfa_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK (kind <> 'admin' OR mfa_verified)
);
CREATE INDEX auth_sessions_user_id ON auth_sessions(user_id);

-- Shared persistent fixed windows; serialized updates are used across API processes.
CREATE TABLE auth_rate_limits (
  key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0)
);

CREATE TABLE auth_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES app_users(id),
  target_id UUID REFERENCES app_users(id),
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
