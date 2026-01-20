-- =============================================================================
-- CRM CLIENT SYNC SCHEMA
-- =============================================================================
-- Migration: 004_crm_sync_schema.sql
-- 
-- Adds support for syncing clients from CRM database into Scheduling DB.
-- Includes tracking for sync runs and coordinate staleness flags.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ADD COLUMNS TO CLIENTS TABLE
-- -----------------------------------------------------------------------------
-- Add fields to track CRM sync status and coordinate freshness

ALTER TABLE clients 
  ADD COLUMN IF NOT EXISTS coords_stale BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ;

-- Update geocode_source check constraint to include 'crm_import'
-- Note: PostgreSQL doesn't support ALTER CHECK constraint directly,
-- so we drop and recreate if needed. For safety, we'll use a DO block.
DO $$
BEGIN
  -- Drop existing constraint if it exists
  ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_geocode_source_check;
  
  -- Recreate with new value
  ALTER TABLE clients 
    ADD CONSTRAINT clients_geocode_source_check 
    CHECK (geocode_source IN ('full_address', 'zip_only', 'city_state', 'manual_pin', 'hrm_import', 'csv_import', 'crm_import'));
EXCEPTION
  WHEN OTHERS THEN
    -- If constraint doesn't exist or other error, try to add it
    BEGIN
      ALTER TABLE clients 
        ADD CONSTRAINT clients_geocode_source_check 
        CHECK (geocode_source IN ('full_address', 'zip_only', 'city_state', 'manual_pin', 'hrm_import', 'csv_import', 'crm_import'));
    EXCEPTION
      WHEN duplicate_object THEN NULL; -- Constraint already exists
    END;
END $$;

-- Add index for efficient querying of stale coordinates
CREATE INDEX IF NOT EXISTS idx_clients_coords_stale ON clients(coords_stale) WHERE coords_stale = true;

-- Add index for CRM sync queries
CREATE INDEX IF NOT EXISTS idx_clients_crm_id ON clients(crm_id) WHERE crm_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. CLIENT_SYNC_RUNS TABLE
-- -----------------------------------------------------------------------------
-- Tracks each sync run from CRM to Scheduling DB

CREATE TABLE IF NOT EXISTS client_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Timing
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  
  -- Status
  status TEXT CHECK (status IN ('running', 'completed', 'failed')) DEFAULT 'running',
  
  -- Statistics
  records_upserted INTEGER DEFAULT 0,
  records_skipped INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,
  
  -- Error tracking
  error TEXT,
  
  -- Additional metadata
  metadata JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for sync run queries
CREATE INDEX IF NOT EXISTS idx_client_sync_runs_status ON client_sync_runs(status);
CREATE INDEX IF NOT EXISTS idx_client_sync_runs_started_at ON client_sync_runs(started_at DESC);

-- -----------------------------------------------------------------------------
-- 3. COMMENTS
-- -----------------------------------------------------------------------------

COMMENT ON TABLE client_sync_runs IS 'Tracks sync runs from CRM database to Scheduling DB';
COMMENT ON COLUMN clients.coords_stale IS 'Flag indicating coordinates may be outdated and need re-geocoding';
COMMENT ON COLUMN clients.source_updated_at IS 'Timestamp when source (CRM) last updated this record';
