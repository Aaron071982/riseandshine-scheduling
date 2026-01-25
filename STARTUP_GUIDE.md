# Startup Guide

Quick reference for starting the Scheduling AI system.

## Prerequisites

1. **Node.js** installed (v18+ recommended)
2. **Environment variables** configured (copy `env.example` to `.env` and fill in values)
3. **Database migrations** run in Supabase SQL editor (in order: `001` through `008`)

## Environment Setup

1. Copy the example environment file:
   ```bash
   cp env.example .env
   ```

2. Edit `.env` and fill in:
   - `SUPABASE_SCHED_URL` - Your Scheduling database URL
   - `SUPABASE_SCHED_SERVICE_ROLE_KEY` - Service role key for Scheduling DB
   - `SUPABASE_SCHED_PROJECT_REF` - Project reference
   - `GOOGLE_MAPS_API_KEY` - Google Maps API key for geocoding
   - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` - HRM database credentials (if syncing RBTs)
   - `CRM_SUPABASE_URL` / `CRM_SUPABASE_SERVICE_ROLE_KEY` - CRM database credentials (if syncing clients)

## Database Setup

Run SQL migrations in order in your Supabase SQL editor:

1. `sql/001_scheduling_schema.sql` - Base schema
2. `sql/002_meta_matching.sql` - Matching metadata
3. `sql/003_matches_run_id.sql` - Match run tracking
4. `sql/004_crm_sync_schema.sql` - CRM sync support
5. `sql/005_match_overrides_schema.sql` - Overrides and approvals
6. `sql/006_simulation_workflow_schema.sql` - Simulation workflow
7. `sql/007_fix_hrm_id_type.sql` - Fix HRM ID type (optional)
8. `sql/008_add_deferred_status.sql` - Add deferred status

## Install Dependencies

```bash
npm install
```

## Sync RBTs from HRM (First Time Setup)

If you need to sync and geocode RBTs from your HRM database:

```bash
npm run sync-rbts
```

This will:
- Fetch only **hired** RBTs from HRM
- Geocode their addresses
- Save them to the Scheduling database with coordinates
- Only includes RBTs with proper zip codes

## Start the Application

### Option 1: Development Mode (Recommended)

**Terminal 1 - API Server:**
```bash
npm run api:dev
```
Runs on: `http://localhost:3001`

**Terminal 2 - Frontend Server:**
```bash
npm run serve
```
Runs on: `http://localhost:3000`

### Option 2: Production Mode

Build and run:
```bash
npm run build
npm run api
npm run serve
```

## Access the Application

Open your browser to:
```
http://localhost:3000
```

## Common Commands

```bash
# Sync and geocode RBTs from HRM
npm run sync-rbts

# Geocode existing RBTs (if coordinates missing)
npm run geocode-rbts

# Test simulation workflow
npm run test-simulation

# Test matching algorithm
npm run match:dry
```

## Troubleshooting

### No RBTs showing on map
- Run `npm run sync-rbts` to sync from HRM
- Ensure RBTs have zip codes (required)
- Check that RBTs are marked as "hired" in HRM

### API server won't start
- Check `.env` file exists and has correct values
- Verify database connection in Supabase dashboard
- Check console for error messages

### Frontend shows errors
- Ensure API server is running on port 3001
- Check browser console (F12) for errors
- Verify `config.js` has Google Maps API key

## Project Structure

```
├── src/
│   ├── api/              # Express API server
│   │   └── routes/       # API route handlers
│   ├── lib/              # Core libraries
│   │   ├── simulation.ts # Simulation workflow logic
│   │   ├── rbts.ts       # RBT data access
│   │   └── clients.ts   # Client data access
│   └── scripts/          # Utility scripts
├── public/               # Frontend files
│   ├── index.html       # Main UI
│   └── app-simple.js    # Frontend logic
├── sql/                 # Database migrations
└── docs/                # Documentation
```

## Notes

- Only **hired** RBTs from HRM are synced
- Only RBTs with **proper zip codes** are included in matching
- Travel time constraint: **30 minutes maximum**
- Approved matches are visible on the map with green lines
