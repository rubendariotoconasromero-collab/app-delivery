CREATE TABLE driver_profiles (
  user_id UUID PRIMARY KEY REFERENCES app_users(id),
  full_name TEXT NOT NULL DEFAULT '' CHECK (length(full_name) <= 150),
  review_status TEXT NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft','pending','approved','rejected','suspended')),
  review_reason TEXT,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES app_users(id),
  active_vehicle_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE driver_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES driver_profiles(user_id),
  plate TEXT NOT NULL UNIQUE CHECK (length(plate) BETWEEN 3 AND 15),
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER NOT NULL CHECK (year BETWEEN 1900 AND 2200),
  capacity_passengers INTEGER NOT NULL CHECK (capacity_passengers BETWEEN 1 AND 8),
  service_types TEXT[] NOT NULL CHECK (cardinality(service_types) BETWEEN 1 AND 2 AND service_types <@ ARRAY['passengers','parcels']::TEXT[]),
  review_status TEXT NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft','pending','approved','rejected','suspended')),
  review_reason TEXT,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(driver_id,id)
);

ALTER TABLE driver_profiles ADD CONSTRAINT driver_active_vehicle_owner
  FOREIGN KEY (user_id,active_vehicle_id) REFERENCES driver_vehicles(driver_id,id);

CREATE TABLE driver_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES driver_profiles(user_id),
  vehicle_id UUID,
  kind TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  storage_name TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  expires_on DATE,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (driver_id,vehicle_id) REFERENCES driver_vehicles(driver_id,id),
  CHECK ((vehicle_id IS NULL AND kind IN ('identity_document','driver_license')) OR (vehicle_id IS NOT NULL AND kind='vehicle_registration')),
  CHECK (kind='identity_document' OR expires_on IS NOT NULL)
);

CREATE UNIQUE INDEX current_driver_document ON driver_documents(driver_id,kind)
  WHERE is_current AND vehicle_id IS NULL;
CREATE UNIQUE INDEX current_vehicle_document ON driver_documents(vehicle_id,kind)
  WHERE is_current AND vehicle_id IS NOT NULL;

CREATE TABLE onboarding_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES app_users(id),
  driver_id UUID NOT NULL REFERENCES driver_profiles(user_id),
  target_type TEXT NOT NULL CHECK (target_type IN ('driver','vehicle','document')),
  target_id UUID NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX onboarding_audit_driver ON onboarding_audit(driver_id,created_at DESC);
CREATE INDEX driver_reviews ON driver_profiles(review_status,submitted_at);
CREATE INDEX driver_vehicles_owner ON driver_vehicles(driver_id);
