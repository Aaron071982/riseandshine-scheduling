-- Add 'deferred' status to match_proposals table
-- Allows proposals to be stalled for later review

ALTER TABLE match_proposals DROP CONSTRAINT IF EXISTS match_proposals_status_check;
ALTER TABLE match_proposals 
  ADD CONSTRAINT match_proposals_status_check 
  CHECK (status IN ('proposed', 'approved', 'rejected', 'expired', 'deferred'));
