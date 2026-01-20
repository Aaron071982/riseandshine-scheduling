-- =============================================================================
-- SIMULATION WORKFLOW SCHEMA
-- =============================================================================
-- Migration: 006_simulation_workflow_schema.sql
-- 
-- Adds support for manual client entry, simulation-based matching, and
-- reversible RBT locks. Implements proposal/approval workflow with atomic
-- state changes via RPC functions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ADAPT CLIENTS TABLE
-- -----------------------------------------------------------------------------
-- Add pairing status and paired RBT reference

ALTER TABLE clients 
  ADD COLUMN IF NOT EXISTS pairing_status TEXT 
    CHECK (pairing_status IN ('unpaired', 'paired')) 
    DEFAULT 'unpaired';

ALTER TABLE clients 
  ADD COLUMN IF NOT EXISTS paired_rbt_id UUID 
    REFERENCES rbt_profiles(id) ON DELETE SET NULL;

-- Update geocode_source constraint to include 'manual_entry'
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_geocode_source_check;
ALTER TABLE clients 
  ADD CONSTRAINT clients_geocode_source_check 
  CHECK (geocode_source IN ('full_address', 'zip_only', 'city_state', 'manual_pin', 'csv_import', 'crm_import', 'manual_entry'));

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_clients_pairing_status ON clients(pairing_status);
CREATE INDEX IF NOT EXISTS idx_clients_paired_rbt ON clients(paired_rbt_id) WHERE paired_rbt_id IS NOT NULL;

-- Set default for existing rows
UPDATE clients SET pairing_status = 'unpaired' WHERE pairing_status IS NULL;

-- -----------------------------------------------------------------------------
-- 2. ADAPT RBT_PROFILES TABLE
-- -----------------------------------------------------------------------------
-- Add availability status and override reason

ALTER TABLE rbt_profiles 
  ADD COLUMN IF NOT EXISTS availability_status TEXT 
    CHECK (availability_status IN ('available', 'locked')) 
    DEFAULT 'available';

ALTER TABLE rbt_profiles 
  ADD COLUMN IF NOT EXISTS availability_override_reason TEXT NULL;

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_rbt_profiles_availability ON rbt_profiles(availability_status);

-- Set default for existing rows
UPDATE rbt_profiles SET availability_status = 'available' WHERE availability_status IS NULL;

-- -----------------------------------------------------------------------------
-- 3. CREATE MATCH_PROPOSALS TABLE
-- -----------------------------------------------------------------------------
-- Stores proposed matches from simulation runs

CREATE TABLE IF NOT EXISTS match_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- References
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  rbt_id UUID NOT NULL REFERENCES rbt_profiles(id) ON DELETE CASCADE,
  
  -- Travel Details
  travel_time_minutes INTEGER NOT NULL,
  distance_meters INTEGER NULL,
  
  -- Status
  status TEXT NOT NULL 
    CHECK (status IN ('proposed', 'approved', 'rejected', 'expired', 'deferred')) 
    DEFAULT 'proposed',
  
  -- Simulation Run Tracking
  simulation_run_id UUID NOT NULL,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint: only one active proposal per client (but allow deferred)
CREATE UNIQUE INDEX IF NOT EXISTS idx_match_proposals_unique_active 
  ON match_proposals(client_id) 
  WHERE status = 'proposed';

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_match_proposals_status ON match_proposals(status);
CREATE INDEX IF NOT EXISTS idx_match_proposals_simulation_run ON match_proposals(simulation_run_id);
CREATE INDEX IF NOT EXISTS idx_match_proposals_client ON match_proposals(client_id);
CREATE INDEX IF NOT EXISTS idx_match_proposals_rbt ON match_proposals(rbt_id);
CREATE INDEX IF NOT EXISTS idx_match_proposals_created ON match_proposals(created_at DESC);

-- -----------------------------------------------------------------------------
-- 4. CREATE PAIRINGS TABLE
-- -----------------------------------------------------------------------------
-- Stores approved pairings with reversible active/inactive status

CREATE TABLE IF NOT EXISTS pairings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- References
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  rbt_id UUID NOT NULL REFERENCES rbt_profiles(id) ON DELETE CASCADE,
  proposal_id UUID REFERENCES match_proposals(id) ON DELETE SET NULL,
  
  -- Status (reversible)
  status TEXT NOT NULL 
    CHECK (status IN ('active', 'inactive')) 
    DEFAULT 'active',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ NULL
);

-- Unique constraint: one active pairing per client
CREATE UNIQUE INDEX IF NOT EXISTS idx_pairings_unique_active_client 
  ON pairings(client_id) 
  WHERE status = 'active';

-- Unique constraint: one active pairing per RBT (TEMPORARY until capacity logic)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pairings_unique_active_rbt 
  ON pairings(rbt_id) 
  WHERE status = 'active';

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_pairings_rbt ON pairings(rbt_id);
CREATE INDEX IF NOT EXISTS idx_pairings_client ON pairings(client_id);
CREATE INDEX IF NOT EXISTS idx_pairings_status ON pairings(status);
CREATE INDEX IF NOT EXISTS idx_pairings_created ON pairings(created_at DESC);

-- -----------------------------------------------------------------------------
-- 5. RPC FUNCTIONS FOR ATOMIC STATE CHANGES
-- -----------------------------------------------------------------------------

-- Function A: Approve a match proposal
CREATE OR REPLACE FUNCTION approve_match_proposal(proposal_id UUID)
RETURNS JSONB AS $$
DECLARE
  proposal_record RECORD;
  client_record RECORD;
  rbt_record RECORD;
  pairing_id UUID;
BEGIN
  -- Step 1: Lock and verify proposal
  SELECT * INTO proposal_record
  FROM match_proposals
  WHERE id = proposal_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found: %', proposal_id;
  END IF;
  
  IF proposal_record.status != 'proposed' THEN
    RAISE EXCEPTION 'Proposal status is not "proposed": %', proposal_record.status;
  END IF;
  
  -- Step 2: Verify client is unpaired (no active pairing)
  SELECT * INTO client_record
  FROM clients
  WHERE id = proposal_record.client_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found: %', proposal_record.client_id;
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM pairings 
    WHERE client_id = proposal_record.client_id 
    AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Client already has an active pairing';
  END IF;
  
  -- Step 3: Verify RBT is available
  SELECT * INTO rbt_record
  FROM rbt_profiles
  WHERE id = proposal_record.rbt_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RBT not found: %', proposal_record.rbt_id;
  END IF;
  
  IF rbt_record.availability_status != 'available' THEN
    RAISE EXCEPTION 'RBT is not available (status: %)', rbt_record.availability_status;
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM pairings 
    WHERE rbt_id = proposal_record.rbt_id 
    AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'RBT already has an active pairing';
  END IF;
  
  -- Step 4: Insert pairing
  pairing_id := gen_random_uuid();
  INSERT INTO pairings (id, client_id, rbt_id, proposal_id, status)
  VALUES (pairing_id, proposal_record.client_id, proposal_record.rbt_id, proposal_id, 'active');
  
  -- Step 5: Update client
  UPDATE clients
  SET pairing_status = 'paired',
      paired_rbt_id = proposal_record.rbt_id,
      updated_at = NOW()
  WHERE id = proposal_record.client_id;
  
  -- Step 6: Update RBT
  UPDATE rbt_profiles
  SET availability_status = 'locked',
      updated_at = NOW()
  WHERE id = proposal_record.rbt_id;
  
  -- Step 7: Update proposal
  UPDATE match_proposals
  SET status = 'approved'
  WHERE id = proposal_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'pairing_id', pairing_id,
    'client_id', proposal_record.client_id,
    'rbt_id', proposal_record.rbt_id
  );
END;
$$ LANGUAGE plpgsql;

-- Function B: Reopen an RBT (make available again)
CREATE OR REPLACE FUNCTION reopen_rbt(rbt_id UUID)
RETURNS JSONB AS $$
DECLARE
  rbt_record RECORD;
  pairings_count INTEGER;
  affected_clients UUID[];
BEGIN
  -- Verify RBT exists
  SELECT * INTO rbt_record
  FROM rbt_profiles
  WHERE id = rbt_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RBT not found: %', rbt_id;
  END IF;
  
  -- Get affected client IDs BEFORE updating (so we can update them)
  SELECT ARRAY_AGG(client_id) INTO affected_clients
  FROM pairings
  WHERE rbt_id = rbt_id
    AND status = 'active';
  
  IF affected_clients IS NULL OR array_length(affected_clients, 1) = 0 THEN
    RAISE EXCEPTION 'No active pairings found for RBT: %', rbt_id;
  END IF;
  
  -- Deactivate all active pairings for this RBT
  UPDATE pairings
  SET status = 'inactive',
      ended_at = NOW()
  WHERE rbt_id = rbt_id
    AND status = 'active';
  
  GET DIAGNOSTICS pairings_count = ROW_COUNT;
  
  -- Update RBT availability
  UPDATE rbt_profiles
  SET availability_status = 'available',
      updated_at = NOW()
  WHERE id = rbt_id;
  
  -- Update affected clients (unpair them)
  UPDATE clients
  SET pairing_status = 'unpaired',
      paired_rbt_id = NULL,
      updated_at = NOW()
  WHERE id = ANY(affected_clients);
  
  RETURN jsonb_build_object(
    'success', true,
    'rbt_id', rbt_id,
    'pairings_deactivated', pairings_count,
    'clients_unpaired', array_length(affected_clients, 1)
  );
END;
$$ LANGUAGE plpgsql;

-- Function C: Reject a match proposal
CREATE OR REPLACE FUNCTION reject_match_proposal(proposal_id UUID)
RETURNS JSONB AS $$
DECLARE
  proposal_record RECORD;
BEGIN
  -- Lock and verify proposal
  SELECT * INTO proposal_record
  FROM match_proposals
  WHERE id = proposal_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found: %', proposal_id;
  END IF;
  
  IF proposal_record.status != 'proposed' THEN
    RAISE EXCEPTION 'Proposal status is not "proposed": %', proposal_record.status;
  END IF;
  
  -- Update proposal status
  UPDATE match_proposals
  SET status = 'rejected'
  WHERE id = proposal_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'proposal_id', proposal_id
  );
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 6. COMMENTS FOR DOCUMENTATION
-- -----------------------------------------------------------------------------

COMMENT ON COLUMN clients.pairing_status IS 'Client pairing status: unpaired or paired';
COMMENT ON COLUMN clients.paired_rbt_id IS 'Reference to currently paired RBT (if paired)';
COMMENT ON COLUMN rbt_profiles.availability_status IS 'RBT availability: available or locked. Updated only via RPC functions.';
COMMENT ON COLUMN rbt_profiles.availability_override_reason IS 'Optional admin notes for availability status';
COMMENT ON TABLE match_proposals IS 'Proposed matches from simulation runs. Status: proposed, approved, rejected, expired.';
COMMENT ON TABLE pairings IS 'Approved pairings with reversible active/inactive status. One active pairing per client and RBT (temporary constraint).';
COMMENT ON COLUMN pairings.status IS 'Pairing status: active or inactive. Inactive pairings can be reactivated by reopening RBT.';
COMMENT ON FUNCTION approve_match_proposal(UUID) IS 'Atomically approves a proposal, creates active pairing, locks RBT, and pairs client';
COMMENT ON FUNCTION reopen_rbt(UUID) IS 'Deactivates active pairings for RBT, sets RBT to available, and unpairs affected clients';
COMMENT ON FUNCTION reject_match_proposal(UUID) IS 'Rejects a proposal without side effects (client remains unpaired)';

-- -----------------------------------------------------------------------------
-- VERIFICATION
-- -----------------------------------------------------------------------------
-- Run this to verify the schema was created correctly:
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('match_proposals', 'pairings');
-- SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name LIKE '%proposal%' OR routine_name LIKE '%rbt%';
