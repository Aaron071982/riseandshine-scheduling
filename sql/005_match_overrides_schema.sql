-- =============================================================================
-- MATCH OVERRIDES & APPROVAL WORKFLOW SCHEMA
-- =============================================================================
-- Migration: 005_match_overrides_schema.sql
-- 
-- Adds support for manual match overrides, approvals, and match run tracking.
-- Allows admins to lock assignments, block pairs, and approve/reject matches.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. MATCH_OVERRIDES TABLE
-- -----------------------------------------------------------------------------
-- Stores manual match decisions and constraints

CREATE TABLE IF NOT EXISTS match_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- References
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  rbt_id UUID NOT NULL REFERENCES rbt_profiles(id) ON DELETE CASCADE,
  
  -- Override Type
  type TEXT NOT NULL CHECK (type IN ('LOCKED_ASSIGNMENT', 'MANUAL_ASSIGNMENT', 'BLOCK_PAIR')),
  
  -- Metadata
  created_by TEXT DEFAULT 'admin',
  notes TEXT,
  
  -- Effective date range (optional)
  effective_from DATE,
  effective_to DATE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicate overrides for same pair
  UNIQUE(client_id, rbt_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_match_overrides_client ON match_overrides(client_id);
CREATE INDEX IF NOT EXISTS idx_match_overrides_rbt ON match_overrides(rbt_id);
CREATE INDEX IF NOT EXISTS idx_match_overrides_type ON match_overrides(type);
CREATE INDEX IF NOT EXISTS idx_match_overrides_effective ON match_overrides(effective_from, effective_to) WHERE effective_from IS NOT NULL OR effective_to IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. MATCH_APPROVALS TABLE
-- -----------------------------------------------------------------------------
-- Tracks approvals/rejections of proposed matches

CREATE TABLE IF NOT EXISTS match_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- References
  match_run_id UUID, -- Reference to match_runs table
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  rbt_id UUID NOT NULL REFERENCES rbt_profiles(id) ON DELETE CASCADE,
  
  -- Approval Status
  approved_by TEXT,
  status TEXT CHECK (status IN ('APPROVED', 'REJECTED')),
  notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_match_approvals_run ON match_approvals(match_run_id) WHERE match_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_match_approvals_client ON match_approvals(client_id);
CREATE INDEX IF NOT EXISTS idx_match_approvals_rbt ON match_approvals(rbt_id);
CREATE INDEX IF NOT EXISTS idx_match_approvals_status ON match_approvals(status);

-- -----------------------------------------------------------------------------
-- 3. EXTEND MATCHES TABLE
-- -----------------------------------------------------------------------------
-- Add fields to track match source and approval status

ALTER TABLE matches 
  ADD COLUMN IF NOT EXISTS source TEXT CHECK (source IN ('AUTO', 'LOCKED', 'MANUAL')) DEFAULT 'AUTO',
  ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS match_run_id UUID; -- Reference to match_runs table

-- Indexes for new fields
CREATE INDEX IF NOT EXISTS idx_matches_source ON matches(source);
CREATE INDEX IF NOT EXISTS idx_matches_approved ON matches(approved) WHERE approved = true;
CREATE INDEX IF NOT EXISTS idx_matches_locked ON matches(locked) WHERE locked = true;
CREATE INDEX IF NOT EXISTS idx_matches_run_id ON matches(match_run_id) WHERE match_run_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. MATCH_RUNS TABLE
-- -----------------------------------------------------------------------------
-- Tracks full metadata for each matching run

CREATE TABLE IF NOT EXISTS match_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Timing
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  
  -- Input Statistics
  input_clients_count INTEGER,
  input_rbts_count INTEGER,
  
  -- Output Statistics
  matched_count INTEGER DEFAULT 0,
  locked_count INTEGER DEFAULT 0,
  manual_count INTEGER DEFAULT 0,
  auto_count INTEGER DEFAULT 0,
  standby_count INTEGER DEFAULT 0,
  no_location_count INTEGER DEFAULT 0,
  blocked_count INTEGER DEFAULT 0,
  
  -- API Metrics
  google_api_calls INTEGER DEFAULT 0,
  cache_hits INTEGER DEFAULT 0,
  cache_hit_rate DECIMAL(5, 2),
  
  -- Additional metadata
  metadata JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_match_runs_started_at ON match_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_runs_ended_at ON match_runs(ended_at DESC) WHERE ended_at IS NOT NULL;

-- Add foreign key constraint for match_run_id in matches table
-- (Do this after match_runs table exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'matches_match_run_id_fkey'
  ) THEN
    ALTER TABLE matches 
      ADD CONSTRAINT matches_match_run_id_fkey 
      FOREIGN KEY (match_run_id) 
      REFERENCES match_runs(id) 
      ON DELETE SET NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. COMMENTS
-- -----------------------------------------------------------------------------

COMMENT ON TABLE match_overrides IS 'Manual match overrides: locked assignments, manual assignments, and blocked pairs';
COMMENT ON TABLE match_approvals IS 'Tracks approval/rejection of proposed matches';
COMMENT ON TABLE match_runs IS 'Tracks full metadata for each matching algorithm run';
COMMENT ON COLUMN matches.source IS 'Match source: AUTO (algorithm), LOCKED (override), MANUAL (admin-assigned)';
COMMENT ON COLUMN matches.locked IS 'Whether this match is locked and cannot be changed by algorithm';
COMMENT ON COLUMN matches.match_run_id IS 'Reference to the match run that generated this match';
