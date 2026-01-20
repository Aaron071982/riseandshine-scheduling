-- =============================================================================
-- Migration: Add run tracking to matches table
-- =============================================================================
-- This migration adds columns to track which matching run created each match,
-- allowing for safe replacement of matches without losing historical data.
-- =============================================================================

-- Add columns to matches table
ALTER TABLE matches
ADD COLUMN IF NOT EXISTS run_id UUID,
ADD COLUMN IF NOT EXISTS computed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

-- Add index for efficient queries
CREATE INDEX IF NOT EXISTS idx_matches_run_id_active ON matches(run_id, active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_matches_computed_at ON matches(computed_at DESC);

-- Add comment for documentation
COMMENT ON COLUMN matches.run_id IS 'UUID identifying the matching run that created this match';
COMMENT ON COLUMN matches.computed_at IS 'Timestamp when this match was computed';
COMMENT ON COLUMN matches.active IS 'Whether this match is the current active match (false for historical matches)';

-- Update existing matches to be active (backfill)
UPDATE matches SET active = true WHERE active IS NULL;

