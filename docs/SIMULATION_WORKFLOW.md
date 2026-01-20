# Simulation Workflow Guide

## Overview

The Simulation Workflow provides a manual, proposal-based approach to matching clients with RBTs. This workflow is ideal when you want to:
- Manually add clients one at a time
- Review and approve matches before they become active
- Have fine-grained control over which RBTs are assigned to which clients

## Workflow Steps

### 1. Add Clients

**Location**: Dashboard → Simulation Tab → "Add Client" form

1. Enter client name (required)
2. Enter full address (required) - will be automatically geocoded
3. Add optional notes
4. Click "Add Client"

The system will:
- Geocode the address using Google Maps
- Store the client with `pairing_status='unpaired'`
- Display the client in the list

**Note**: Clients must have valid coordinates (lat/lng) to be included in simulations.

### 2. Run Simulation

**Location**: Dashboard → Simulation Tab → "Run Simulation" button

1. Click "Run Simulation"
2. Confirm the action
3. Wait for simulation to complete

The simulation will:
- Find all unpaired clients with valid coordinates
- Find all available RBTs (status='available') with valid coordinates
- For each unpaired client:
  - Calculate travel time to each available RBT (using cache when possible)
  - Filter to only RBTs within 30 minutes travel time (hard constraint)
  - Select the RBT with minimum travel time
  - Create a proposal with `status='proposed'`
- Return summary: proposals created, clients processed, any errors

**Important**: 
- Only one active proposal per client (old proposals are expired)
- Travel time must be ≤ 30 minutes (hard constraint)
- Uses cached travel times when available to reduce API calls

### 3. Review Proposals

**Location**: Dashboard → Simulation Tab → Proposals List

Proposals are displayed with:
- Client name
- RBT name
- Travel time (minutes)
- Distance (miles)
- Creation timestamp

Filter by status:
- **Proposed**: Pending approval
- **Approved**: Already approved (created pairing)
- **Rejected**: Rejected by admin

### 4. Approve Proposal

**Location**: Dashboard → Simulation Tab → Proposals List → "Approve" button

1. Click "Approve" on a proposal
2. Confirm the action

**What happens** (atomic transaction via RPC):
1. Verifies proposal is still 'proposed'
2. Verifies client is unpaired
3. Verifies RBT is available
4. Creates active pairing record
5. Updates client: `pairing_status='paired'`, `paired_rbt_id=rbt_id`
6. Updates RBT: `availability_status='locked'`
7. Updates proposal: `status='approved'`

**Error Handling**:
- If RBT already locked: Clear error message
- If client already paired: Clear error message
- All changes are atomic (all or nothing)

### 5. Reject Proposal

**Location**: Dashboard → Simulation Tab → Proposals List → "Reject" button

1. Click "Reject" on a proposal
2. Confirm the action

**What happens**:
- Proposal status changes to 'rejected'
- Client remains unpaired
- RBT remains available
- No other side effects

### 6. Reopen RBT

**Location**: Dashboard → Paired Clients section → "Reopen RBT" button

**When to use**: When an RBT can take additional clients (capacity changes, schedule opens up, etc.)

1. Find the paired client in the "Paired Clients" section
2. Click "Reopen RBT" button
3. Confirm the action

**What happens** (atomic transaction via RPC):
1. Finds all active pairings for the RBT
2. Sets pairings to `status='inactive'`, `ended_at=NOW()`
3. Updates RBT: `availability_status='available'`
4. Updates affected clients: `pairing_status='unpaired'`, `paired_rbt_id=NULL`
5. Returns client(s) to simulation pool

**Important Notes**:
- Reopening an RBT unpairs all clients currently paired with that RBT
- Those clients become unpaired and can be matched again in future simulations
- The pairing history is preserved (status='inactive' with ended_at timestamp)

## Database Schema

### Tables

**clients** (adapted):
- `pairing_status`: 'unpaired' | 'paired'
- `paired_rbt_id`: UUID reference to paired RBT (if paired)

**rbt_profiles** (adapted):
- `availability_status`: 'available' | 'locked'
- `availability_override_reason`: Optional admin notes

**match_proposals** (new):
- Stores proposed matches from simulation runs
- Status: 'proposed' | 'approved' | 'rejected' | 'expired'
- Unique constraint: Only one active proposal per client

**pairings** (new):
- Stores approved pairings
- Status: 'active' | 'inactive' (reversible)
- Unique constraints:
  - One active pairing per client
  - One active pairing per RBT (**TEMPORARY** - will be relaxed when capacity logic is added)

### RPC Functions

All state changes happen through Postgres RPC functions for atomicity:

- `approve_match_proposal(proposal_id)`: Approves proposal, creates pairing, locks RBT
- `reopen_rbt(rbt_id)`: Deactivates pairings, unlocks RBT, unpairs clients
- `reject_match_proposal(proposal_id)`: Rejects proposal (no side effects)

## Travel Time Calculation

- Uses existing `travel_time_cache` table
- Caches results to reduce Google API calls
- Uses deterministic time bucket: 'weekday_2to8' (2 PM - 8 PM weekday window)
- Hard constraint: Travel time must be ≤ 30 minutes

## Constraints and Limitations

### Current Constraints

1. **One Active Pairing Per RBT**: 
   - Temporary constraint until capacity/schedule logic is implemented
   - When capacity features are added, this constraint will be removed/relaxed
   - For now, reopening an RBT is required to pair them with a different client

2. **30-Minute Travel Time Limit**:
   - Hard constraint in simulation
   - RBTs beyond 30 minutes are not considered
   - This ensures reasonable commute times

3. **Manual Capacity Management**:
   - Capacity/schedule logic not yet implemented
   - Admins must manually reopen RBTs when they can take additional clients
   - Future enhancement will add automatic capacity tracking

### Future Enhancements

- Capacity/schedule logic (hours per week, availability windows)
- Automatic capacity tracking
- Multi-client pairing per RBT (when capacity allows)
- Schedule-based matching (time slots, recurring appointments)

## Troubleshooting

### No Proposals Created

**Possible causes**:
- No unpaired clients with valid coordinates
- No available RBTs with valid coordinates
- All RBTs are more than 30 minutes away from clients
- All RBTs are locked

**Solutions**:
- Verify clients have been geocoded (check lat/lng in database)
- Verify RBTs have coordinates and are marked 'available'
- Check travel times manually
- Reopen locked RBTs if needed

### Approval Fails

**Error: "RBT already has an active pairing"**
- The RBT is already paired with another client
- Reopen the RBT first if you want to change the pairing

**Error: "Client already has an active pairing"**
- The client is already paired
- Check the paired clients list

**Error: "RBT is not available"**
- The RBT's availability_status is not 'available'
- Check RBT status in database or use reopen function

### Reopen Fails

**Error: "No active pairings found"**
- The RBT doesn't have any active pairings
- Check if RBT is already available

**Error: "RBT not found"**
- Invalid RBT ID
- Verify the RBT exists in the database

## Testing

Run the test script to verify the workflow:

```bash
npm run test-simulation
# Or directly:
ts-node src/scripts/test-simulation.ts
```

The test script:
1. Adds 2 test clients
2. Runs simulation
3. Approves a proposal
4. Verifies RBT is locked
5. Reopens the RBT
6. Verifies RBT is available again
7. Runs simulation again and verifies RBT is considered

## Best Practices

1. **Geocode Quality**: Ensure addresses are complete and accurate for best geocoding results
2. **Review Before Approving**: Check travel times and distances before approving
3. **Monitor RBT Availability**: Keep track of which RBTs are locked vs available
4. **Use Reopen Judiciously**: Reopening affects all clients paired with that RBT
5. **Cache Benefits**: The system caches travel times - subsequent simulations will be faster

## API Examples

### Add Client
```bash
curl -X POST http://localhost:3001/api/admin/simulation/add-client \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "address": "123 Main St, Brooklyn, NY 11201",
    "notes": "Prefers morning sessions"
  }'
```

### Run Simulation
```bash
curl -X POST http://localhost:3001/api/admin/simulation/run
```

### Get Proposals
```bash
curl http://localhost:3001/api/admin/simulation/proposals?status=proposed
```

### Approve Proposal
```bash
curl -X POST http://localhost:3001/api/admin/simulation/approve/{proposal_id}
```

### Reopen RBT
```bash
curl -X POST http://localhost:3001/api/admin/rbts/{rbt_id}/reopen
```
