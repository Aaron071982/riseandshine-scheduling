-- =============================================================================
-- SCHEDULING AI DATABASE SCHEMA
-- =============================================================================
-- Run this SQL in your NEW Supabase project (separate from HRM!)
-- This creates all tables needed for the scheduling system.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. SCHEDULING_META TABLE (Safety check - create this first!)
-- -----------------------------------------------------------------------------
-- This table is used to verify we're connected to the correct database.
-- The validateSchedulingDB() function checks for this table on startup.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scheduling_meta (
  id INTEGER PRIMARY KEY DEFAULT 1,
  project_name TEXT NOT NULL DEFAULT 'scheduling-ai',
  version TEXT DEFAULT '1.0.0',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Insert the safety marker
INSERT INTO scheduling_meta (id, project_name, version) 
VALUES (1, 'scheduling-ai', '1.0.0')
ON CONFLICT (id) DO UPDATE SET updated_at = NOW();

-- -----------------------------------------------------------------------------
-- 2. RBT_PROFILES TABLE
-- -----------------------------------------------------------------------------
-- Stores RBT information with geocoding metadata.
-- This is a COPY of RBT data, synced from HRM (not the HRM table itself).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rbt_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Basic Information
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  full_name TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
  email TEXT UNIQUE,
  phone TEXT,
  
  -- Address Information
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  
  -- Geocoding Results
  lat DECIMAL(10, 8),
  lng DECIMAL(11, 8),
  geocode_precision TEXT CHECK (geocode_precision IN ('ROOFTOP', 'RANGE_INTERPOLATED', 'GEOMETRIC_CENTER', 'APPROXIMATE')),
  geocode_confidence DECIMAL(3, 2) CHECK (geocode_confidence >= 0 AND geocode_confidence <= 1),
  geocode_source TEXT CHECK (geocode_source IN ('full_address', 'zip_only', 'city_state', 'manual_pin', 'hrm_import')),
  geocode_updated_at TIMESTAMPTZ,
  geocode_address_used TEXT, -- The address string that was geocoded
  
  -- Status & Availability
  status TEXT DEFAULT 'ACTIVE',
  is_active BOOLEAN DEFAULT true,
  
  -- Transport & Preferences
  transport_mode TEXT DEFAULT 'Both' CHECK (transport_mode IN ('Car', 'Transit', 'Both')),
  gender TEXT CHECK (gender IN ('Male', 'Female')),
  
  -- Training & Certification
  forty_hour_course_completed BOOLEAN DEFAULT false,
  forty_hour_course_link TEXT,
  
  -- HRM Sync
  hrm_id UUID, -- Original ID from HRM system (for sync)
  hrm_synced_at TIMESTAMPTZ,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_rbt_profiles_status ON rbt_profiles(status);
CREATE INDEX IF NOT EXISTS idx_rbt_profiles_is_active ON rbt_profiles(is_active);
CREATE INDEX IF NOT EXISTS idx_rbt_profiles_location ON rbt_profiles(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rbt_profiles_geocode_precision ON rbt_profiles(geocode_precision);
CREATE INDEX IF NOT EXISTS idx_rbt_profiles_hrm_id ON rbt_profiles(hrm_id) WHERE hrm_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. CLIENTS TABLE
-- -----------------------------------------------------------------------------
-- Stores client information with geocoding metadata.
-- Migrated from CSV or synced from CRM.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Basic Information
  name TEXT NOT NULL,
  status TEXT, -- 'Active', 'Pending', 'On Hold', etc.
  phone TEXT,
  email TEXT,
  age INTEGER,
  
  -- Address Information
  address_line TEXT,
  city TEXT,
  state TEXT DEFAULT 'NY',
  zip TEXT,
  location_borough TEXT, -- 'Brooklyn', 'Queens', 'Manhattan', etc.
  
  -- Geocoding Results
  lat DECIMAL(10, 8),
  lng DECIMAL(11, 8),
  geocode_precision TEXT CHECK (geocode_precision IN ('ROOFTOP', 'RANGE_INTERPOLATED', 'GEOMETRIC_CENTER', 'APPROXIMATE')),
  geocode_confidence DECIMAL(3, 2) CHECK (geocode_confidence >= 0 AND geocode_confidence <= 1),
  geocode_source TEXT CHECK (geocode_source IN ('full_address', 'zip_only', 'city_state', 'manual_pin', 'csv_import')),
  geocode_updated_at TIMESTAMPTZ,
  geocode_address_used TEXT, -- The address string that was geocoded
  needs_location_verification BOOLEAN DEFAULT false,
  
  -- Insurance & Medical
  cin_number TEXT,
  insurance_provider TEXT,
  insurance_id TEXT,
  diagnosis TEXT,
  hours_per_week INTEGER,
  
  -- Notes
  notes TEXT,
  next_steps TEXT,
  
  -- CRM Sync
  crm_id TEXT, -- Original ID from CRM (for sync)
  crm_synced_at TIMESTAMPTZ,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_location ON clients(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clients_borough ON clients(location_borough);
CREATE INDEX IF NOT EXISTS idx_clients_geocode_precision ON clients(geocode_precision);
CREATE INDEX IF NOT EXISTS idx_clients_needs_verification ON clients(needs_location_verification) WHERE needs_location_verification = true;

-- -----------------------------------------------------------------------------
-- 4. TRAVEL_TIME_CACHE TABLE
-- -----------------------------------------------------------------------------
-- Caches travel time calculations to reduce API calls.
-- Uses geohash for efficient lookups.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS travel_time_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Origin/Destination Identifiers with explicit types
  origin_id UUID,
  origin_type TEXT NOT NULL CHECK (origin_type IN ('rbt', 'client')),
  dest_id UUID,
  dest_type TEXT NOT NULL CHECK (dest_type IN ('rbt', 'client')),
  
  -- Coordinates
  origin_lat DECIMAL(10, 8) NOT NULL,
  origin_lng DECIMAL(11, 8) NOT NULL,
  dest_lat DECIMAL(10, 8) NOT NULL,
  dest_lng DECIMAL(11, 8) NOT NULL,
  
  -- Geohash for efficient lookups (rounded to ~100m precision)
  origin_hash TEXT NOT NULL,
  dest_hash TEXT NOT NULL,
  
  -- Travel Parameters
  mode TEXT NOT NULL CHECK (mode IN ('driving', 'transit')),
  time_bucket TEXT NOT NULL DEFAULT 'weekday_3to8', -- e.g., 'weekday_3to8', 'weekend'
  traffic_model TEXT DEFAULT 'pessimistic' CHECK (traffic_model IN ('best_guess', 'pessimistic', 'optimistic')),
  
  -- Results (averaged from multiple departure times)
  duration_sec_avg INTEGER NOT NULL,
  duration_sec_pessimistic INTEGER,
  duration_sec_optimistic INTEGER,
  distance_meters INTEGER,
  
  -- Sample times used for averaging
  sample_times TEXT[], -- Array of departure times used
  sample_durations INTEGER[], -- Array of durations for each sample
  
  -- Metadata
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ, -- computed_at + TTL
  api_calls_used INTEGER DEFAULT 1,
  
  -- Unique constraint for cache key (includes types for disambiguation)
  UNIQUE(origin_hash, dest_hash, origin_type, dest_type, mode, time_bucket)
);

-- Indexes for cache lookups
CREATE INDEX IF NOT EXISTS idx_travel_cache_lookup ON travel_time_cache(origin_hash, dest_hash, mode, time_bucket);
CREATE INDEX IF NOT EXISTS idx_travel_cache_expires ON travel_time_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_travel_cache_computed ON travel_time_cache(computed_at);

-- -----------------------------------------------------------------------------
-- 5. MATCHES TABLE
-- -----------------------------------------------------------------------------
-- Stores client-RBT matches with travel time and status.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- References
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  rbt_id UUID REFERENCES rbt_profiles(id) ON DELETE SET NULL,
  
  -- Match Details
  status TEXT DEFAULT 'matched' CHECK (status IN ('matched', 'scheduled', 'completed', 'standby', 'cancelled', 'needs_review')),
  travel_time_seconds INTEGER,
  travel_time_minutes INTEGER,
  distance_miles DECIMAL(5, 2),
  travel_mode TEXT CHECK (travel_mode IN ('driving', 'transit')),
  
  -- Geocoding Quality (for debugging)
  client_geocode_precision TEXT,
  rbt_geocode_precision TEXT,
  needs_review BOOLEAN DEFAULT false,
  review_reason TEXT,
  
  -- Scheduling
  scheduled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  reason TEXT,
  
  -- Cache Reference
  travel_cache_id UUID REFERENCES travel_time_cache(id),
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(client_id, rbt_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_matches_client ON matches(client_id);
CREATE INDEX IF NOT EXISTS idx_matches_rbt ON matches(rbt_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_needs_review ON matches(needs_review) WHERE needs_review = true;

-- -----------------------------------------------------------------------------
-- 6. MATCH_SUGGESTIONS TABLE
-- -----------------------------------------------------------------------------
-- Stores potential RBT-Client matches pending admin approval.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS match_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- References
  rbt_id UUID NOT NULL REFERENCES rbt_profiles(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  
  -- Status
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  
  -- Match Quality
  score NUMERIC(5, 2) NOT NULL, -- Match quality score (0-100)
  rationale JSONB, -- Explanation: travel time, zip match, quality flags, etc.
  
  -- Travel Details
  travel_time_sec INTEGER,
  distance_meters INTEGER,
  travel_mode TEXT CHECK (travel_mode IN ('driving', 'transit')),
  
  -- Geocoding Quality Flags
  client_geocode_precision TEXT,
  rbt_geocode_precision TEXT,
  needs_review BOOLEAN DEFAULT false,
  review_reason TEXT,
  
  -- Decision Tracking
  decided_at TIMESTAMPTZ,
  decided_by TEXT, -- Admin user identifier
  
  -- Metadata
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicate suggestions
  UNIQUE(rbt_id, client_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_match_suggestions_status ON match_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_match_suggestions_rbt ON match_suggestions(rbt_id);
CREATE INDEX IF NOT EXISTS idx_match_suggestions_client ON match_suggestions(client_id);
CREATE INDEX IF NOT EXISTS idx_match_suggestions_score ON match_suggestions(score DESC);
CREATE INDEX IF NOT EXISTS idx_match_suggestions_pending ON match_suggestions(status) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_match_suggestions_computed ON match_suggestions(computed_at DESC);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_match_suggestions_updated_at ON match_suggestions;
CREATE TRIGGER update_match_suggestions_updated_at
  BEFORE UPDATE ON match_suggestions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- 7. SCHEDULES TABLE
-- -----------------------------------------------------------------------------
-- Stores actual scheduled appointments.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- References
  match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  rbt_id UUID REFERENCES rbt_profiles(id) ON DELETE CASCADE,
  
  -- Schedule Details
  scheduled_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  duration_hours DECIMAL(3, 2),
  
  -- Status
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),
  
  -- Location
  service_location TEXT,
  travel_time_minutes INTEGER,
  
  -- Notes
  notes TEXT,
  cancellation_reason TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_schedules_rbt ON schedules(rbt_id);
CREATE INDEX IF NOT EXISTS idx_schedules_client ON schedules(client_id);
CREATE INDEX IF NOT EXISTS idx_schedules_status ON schedules(status);

-- Constraint: Ensure scheduling hours are 3PM-9PM
ALTER TABLE schedules DROP CONSTRAINT IF EXISTS check_schedule_hours;
ALTER TABLE schedules ADD CONSTRAINT check_schedule_hours 
  CHECK (EXTRACT(HOUR FROM start_time) >= 15 AND EXTRACT(HOUR FROM end_time) <= 21);

-- -----------------------------------------------------------------------------
-- 7. HELPER FUNCTIONS
-- -----------------------------------------------------------------------------

-- Function to generate geohash from lat/lng (simplified - rounds to ~100m)
CREATE OR REPLACE FUNCTION generate_location_hash(lat DECIMAL, lng DECIMAL)
RETURNS TEXT AS $$
BEGIN
  -- Round to 3 decimal places (~100m precision)
  RETURN ROUND(lat::numeric, 3)::text || ',' || ROUND(lng::numeric, 3)::text;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
DROP TRIGGER IF EXISTS update_rbt_profiles_updated_at ON rbt_profiles;
CREATE TRIGGER update_rbt_profiles_updated_at
  BEFORE UPDATE ON rbt_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_clients_updated_at ON clients;
CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_matches_updated_at ON matches;
CREATE TRIGGER update_matches_updated_at
  BEFORE UPDATE ON matches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_schedules_updated_at ON schedules;
CREATE TRIGGER update_schedules_updated_at
  BEFORE UPDATE ON schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY (Optional - enable as needed)
-- -----------------------------------------------------------------------------

-- Enable RLS (uncomment when ready)
-- ALTER TABLE rbt_profiles ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE travel_time_cache ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- VERIFICATION
-- -----------------------------------------------------------------------------
-- Run this to verify the schema was created correctly:
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
-- -----------------------------------------------------------------------------

