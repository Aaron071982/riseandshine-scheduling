# Rise and Shine - Scheduling AI System

An intelligent RBT (Registered Behavior Technician) to Client scheduling and matching system with real-time geocoding, travel time optimization, and comprehensive admin controls.

## Overview

This system automatically matches RBTs with clients based on:
- **Geographic proximity** (using Google Maps API for accurate travel times)
- **Schedule availability** 
- **Fair workload distribution**
- **Manual overrides and approvals** (locked assignments, blocked pairs, manual matches)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (Public)                       │
│  • Interactive Dashboard (React-like vanilla JS)            │
│  • Google Maps visualization                                │
│  • Match management UI                                       │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                    API Server (Express)                      │
│  • REST API endpoints                                        │
│  • Match management                                          │
│  • Client/RBT synchronization                               │
│  • Override management                                       │
└───────────────────────┬─────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
┌───────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
│  Scheduling  │ │     HRM     │ │     CRM     │
│     DB       │ │     DB      │ │     DB      │
│  (Supabase)  │ │  (Supabase) │ │  (Supabase) │
│              │ │             │ │             │
│ • Clients    │ │ • RBTs      │ │ • Clients   │
│ • Matches    │ │ • Schedules │ │ (read-only) │
│ • Overrides  │ │             │ │             │
│ • Cache      │ │             │ │             │
└──────────────┘ └─────────────┘ └─────────────┘
```

## Key Features

### 🤖 Intelligent Matching
- **Travel Time Optimization**: Uses Google Maps Distance Matrix API with intelligent caching
- **Peak Traffic Awareness**: Considers rush hour traffic patterns
- **Location Quality Scoring**: Flags low-quality geocodes for manual review
- **Fair Distribution**: Balances workload across RBTs

### 📊 Admin Controls
- **Manual Overrides**: Lock specific assignments, block incompatible pairs, manual matches
- **Approval Workflow**: Review and approve/reject proposed matches
- **Sync Management**: Sync clients from CRM database with change detection
- **Audit Trail**: Complete match run history with metrics

### 📍 Geocoding & Location
- **Automatic Geocoding**: Converts addresses to coordinates using Google Maps
- **Precision Tracking**: ROOFTOP, RANGE_INTERPOLATED, APPROXIMATE classification
- **Cache Invalidation**: Automatic cache clearing when coordinates change
- **Location Verification**: Manual verification UI for low-quality locations

### 🔄 Data Synchronization
- **CRM Integration**: Read-only client data sync from CRM database
- **Change Detection**: Automatically flags stale coordinates when addresses change
- **Fail-Safe**: Gracefully handles CRM unavailability

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in:

```bash
# Scheduling Database (Primary)
SCHED_SUPABASE_URL=your-scheduling-db-url
SCHED_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# HRM Database (RBT data)
HRM_SUPABASE_URL=your-hrm-db-url
HRM_SUPABASE_SERVICE_ROLE_KEY=your-hrm-service-role-key

# CRM Database (Client data - optional)
CRM_SUPABASE_URL=your-crm-db-url
CRM_SUPABASE_SERVICE_ROLE_KEY=your-crm-service-role-key

# Google Maps API
GOOGLE_MAPS_API_KEY=your-google-maps-api-key
```

### 3. Run Database Migrations

Execute SQL migrations in order:
```bash
sql/001_scheduling_schema.sql
sql/002_meta_matching.sql
sql/003_matches_run_id.sql
sql/004_crm_sync_schema.sql
sql/005_match_overrides_schema.sql
```

### 4. Start Servers

**API Server** (port 3001):
```bash
npm run api:dev
```

**Frontend Server** (port 3000):
```bash
npm run serve
```

Visit `http://localhost:3000` to access the dashboard.

## Project Structure

```
.
├── src/
│   ├── api/                    # Express API server
│   │   ├── routes/            # API route handlers
│   │   │   ├── location.ts    # Location verification endpoints
│   │   │   ├── matches.ts     # Match query endpoints
│   │   │   ├── matching.ts    # Matching algorithm triggers
│   │   │   └── overrides.ts   # Override management
│   │   └── server.ts          # Express server setup
│   ├── lib/
│   │   ├── clients.ts         # Client data access layer
│   │   ├── rbts.ts            # RBT data access layer
│   │   ├── config.ts          # Configuration management
│   │   ├── geocoding/         # Geocoding services
│   │   │   ├── geocode.ts     # Google Maps geocoding
│   │   │   └── normalize.ts   # Address normalization
│   │   ├── scheduling/
│   │   │   ├── matcher.ts     # Core matching algorithm
│   │   │   ├── travelTimeCache.ts  # Travel time caching
│   │   │   ├── validation.ts  # Match validation
│   │   │   ├── overrides.ts   # Override management
│   │   │   ├── syncClients.ts # CRM sync service
│   │   │   └── loadClientsFromCrm.ts  # CRM data loader
│   │   ├── supabaseSched.ts   # Scheduling DB client
│   │   ├── supabaseCrm.ts     # CRM DB client
│   │   └── supabaseServer.ts  # HRM DB client
│   ├── jobs/
│   │   └── scheduler.ts       # Automated matching scheduler
│   ├── scripts/               # Utility scripts
│   │   ├── geocode-rbts.ts   # Geocode RBT addresses
│   │   ├── migrate-clients.ts # Import clients from CSV
│   │   └── test-matching.ts   # Test matching algorithm
│   └── index.ts               # Legacy CLI entry point
├── public/                    # Frontend assets
│   ├── index.html            # Dashboard HTML
│   ├── app.js                # Frontend JavaScript
│   ├── styles.css            # Styling
│   └── server.js             # Simple HTTP server
├── sql/                      # Database migrations
├── scripts/                  # Build scripts
└── docs/                     # Documentation
```

## API Endpoints

### Matching
- `POST /api/admin/matching/run-matching` - Run matching algorithm
- `POST /api/admin/scheduling/approve` - Approve/reject matches
- `GET /api/admin/matches` - Query matches with filters

### Simulation Workflow
- `POST /api/admin/simulation/add-client` - Add client manually with geocoding
- `POST /api/admin/simulation/run` - Run simulation to create proposals
- `GET /api/admin/simulation/proposals` - Get proposals (filter by status)
- `POST /api/admin/simulation/approve/:proposal_id` - Approve a proposal (creates pairing)
- `POST /api/admin/simulation/reject/:proposal_id` - Reject a proposal
- `GET /api/admin/simulation/paired` - Get all paired clients
- `POST /api/admin/rbts/:id/reopen` - Reopen RBT (make available again)
- `GET /api/admin/rbts` - Get RBTs with availability filter

### Overrides
- `GET /api/admin/scheduling/overrides` - List all overrides
- `POST /api/admin/scheduling/overrides` - Create override
- `DELETE /api/admin/scheduling/overrides/:id` - Delete override

### Synchronization
- `POST /api/admin/scheduling/sync-clients` - Sync clients from CRM
- `GET /api/admin/scheduling/sync-clients/status` - Get sync status

### Location
- `GET /api/location/verify` - Get locations needing verification
- `POST /api/location/update` - Update location coordinates

## Scripts

```bash
npm run api:dev        # Start API server in development mode
npm run serve          # Start frontend server
npm run start          # Run matching algorithm (CLI)
npm run geocode-rbts   # Geocode all RBT addresses
npm run migrate-clients # Import clients from CSV
npm run match:dry      # Test matching algorithm (dry run)
```

## Simulation Workflow

The system includes a manual client entry and simulation-based matching workflow:

1. **Add Clients**: Manually add clients with address (automatically geocoded)
2. **Run Simulation**: Creates proposals for unpaired clients with RBTs within 30 minutes travel time
3. **Review Proposals**: View proposed matches in the dashboard
4. **Approve/Reject**: Approve proposals to create active pairings (locks RBT) or reject to keep client unpaired
5. **Reopen RBTs**: Make locked RBTs available again for future simulations

See [Simulation Workflow Documentation](docs/SIMULATION_WORKFLOW.md) for detailed usage instructions.

## Documentation

- [Integration Guide](docs/INTEGRATION_GUIDE.md) - Detailed integration documentation
- [Quick Start Guide](docs/QUICKSTART.md) - Step-by-step setup guide
- [Status Management](docs/STATUS_MANAGEMENT_INTEGRATION.md) - Status workflow documentation
- [Simulation Workflow](docs/SIMULATION_WORKFLOW.md) - Manual client entry and proposal-based matching guide

## License

ISC
