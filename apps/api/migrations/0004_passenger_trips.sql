CREATE TABLE passenger_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES app_users(id),
  origin JSONB NOT NULL,
  destination JSONB NOT NULL,
  passenger_count INTEGER NOT NULL CHECK (passenger_count BETWEEN 1 AND 8),
  route JSONB NOT NULL,
  fare JSONB NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000),
  currency TEXT NOT NULL DEFAULT 'BOB' CHECK (currency = 'BOB'),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX passenger_quotes_client ON passenger_quotes(client_id, created_at DESC);

CREATE TABLE passenger_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL UNIQUE REFERENCES passenger_quotes(id),
  client_id UUID NOT NULL REFERENCES app_users(id),
  driver_id UUID REFERENCES driver_profiles(user_id),
  vehicle_id UUID,
  state TEXT NOT NULL DEFAULT 'searching' CHECK (state IN ('searching','assigned','arrived','in_progress','completed','cancelled','no_driver','interrupted')),
  origin JSONB NOT NULL,
  destination JSONB NOT NULL,
  passenger_count INTEGER NOT NULL CHECK (passenger_count BETWEEN 1 AND 8),
  route JSONB NOT NULL,
  fare JSONB NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000),
  currency TEXT NOT NULL DEFAULT 'BOB' CHECK (currency = 'BOB'),
  search_expires_at TIMESTAMPTZ NOT NULL,
  start_pin_cipher TEXT,
  start_pin_hash TEXT,
  pin_attempts INTEGER NOT NULL DEFAULT 0 CHECK (pin_attempts BETWEEN 0 AND 5),
  pin_consumed_at TIMESTAMPTZ,
  pin_expires_at TIMESTAMPTZ,
  pin_renewals INTEGER NOT NULL DEFAULT 0 CHECK (pin_renewals BETWEEN 0 AND 5),
  version INTEGER NOT NULL DEFAULT 1,
  assigned_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completion_position JSONB,
  ended_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(driver_id,vehicle_id) REFERENCES driver_vehicles(driver_id,id),
  CHECK ((driver_id IS NULL AND vehicle_id IS NULL) OR (driver_id IS NOT NULL AND vehicle_id IS NOT NULL)),
  CHECK (client_id IS DISTINCT FROM driver_id)
);
CREATE UNIQUE INDEX passenger_one_active_client ON passenger_trips(client_id) WHERE state IN ('searching','assigned','arrived','in_progress');
CREATE UNIQUE INDEX passenger_one_active_driver ON passenger_trips(driver_id) WHERE state IN ('assigned','arrived','in_progress');
CREATE INDEX passenger_trips_state ON passenger_trips(state,created_at DESC);
CREATE INDEX passenger_trips_driver ON passenger_trips(driver_id,created_at DESC);

CREATE TABLE driver_presence (
  driver_id UUID PRIMARY KEY REFERENCES driver_profiles(user_id),
  available BOOLEAN NOT NULL DEFAULT FALSE,
  position JSONB,
  captured_at TIMESTAMPTZ,
  sequence BIGINT NOT NULL DEFAULT -1,
  received_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE passenger_trip_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES passenger_trips(id),
  driver_id UUID NOT NULL REFERENCES driver_profiles(user_id),
  vehicle_id UUID NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','rejected','expired','withdrawn')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_by UUID NOT NULL REFERENCES app_users(id),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  FOREIGN KEY(driver_id,vehicle_id) REFERENCES driver_vehicles(driver_id,id)
);
CREATE UNIQUE INDEX passenger_one_pending_offer ON passenger_trip_offers(trip_id) WHERE state='pending';
CREATE UNIQUE INDEX passenger_one_pending_driver ON passenger_trip_offers(driver_id) WHERE state='pending';
CREATE INDEX passenger_offers_driver ON passenger_trip_offers(driver_id,state,expires_at);

CREATE TABLE passenger_cash_declarations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL UNIQUE REFERENCES passenger_trips(id),
  actor_id UUID NOT NULL REFERENCES app_users(id),
  expected_cents INTEGER NOT NULL CHECK (expected_cents > 0),
  received_cents INTEGER NOT NULL CHECK (received_cents >= 0 AND received_cents <= expected_cents),
  status TEXT NOT NULL CHECK (status IN ('declared_paid','partial','unpaid')),
  reconciliation_status TEXT NOT NULL DEFAULT 'pending' CHECK (reconciliation_status = 'pending'),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE passenger_trip_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES passenger_trips(id),
  actor_id UUID REFERENCES app_users(id),
  action TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  reason TEXT,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX passenger_trip_audit_trip ON passenger_trip_audit(trip_id,created_at,id);

CREATE TABLE passenger_trip_commands (
  actor_id UUID NOT NULL REFERENCES app_users(id),
  idempotency_key UUID NOT NULL,
  operation TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(actor_id,idempotency_key)
);
