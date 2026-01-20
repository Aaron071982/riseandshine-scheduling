-- =============================================================================
-- Migration: Add matching run tracking to scheduling_meta
-- =============================================================================
-- This migration adds columns to track the last matching run and summary.
-- =============================================================================

-- Add columns to scheduling_meta table
ALTER TABLE scheduling_meta
ADD COLUMN IF NOT EXISTS last_matching_run_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_matching_summary JSONB;

-- Add comment for documentation
COMMENT ON COLUMN scheduling_meta.last_matching_run_at IS 'Timestamp of the last automated matching job run';
COMMENT ON COLUMN scheduling_meta.last_matching_summary IS 'JSON summary of last matching run: {matchedCount, standbyCount, noLocationCount, durationSec, runId, googleApiCalls, cacheHits}';

