# Scheduling AI - Project Overview

## What is This Project?

This is an **intelligent scheduling and matching system** for Rise and Shine that automatically pairs Registered Behavior Technicians (RBTs) with clients who need behavioral therapy services. The system optimizes matches based on location proximity, travel time, schedule availability, and workload fairness.

## Core Problem It Solves

Manually matching dozens of RBTs to clients is time-consuming and error-prone. This system:
- **Automates the matching process** using intelligent algorithms
- **Optimizes for travel time** using real Google Maps data
- **Ensures fair workload distribution** across RBTs
- **Provides admin controls** for manual adjustments when needed

## How It Works

### 1. Data Collection
- **RBTs**: Fetched from HRM (Human Resources Management) database - includes availability, location, transport mode
- **Clients**: Synced from CRM (Customer Relationship Management) database - includes location, service needs, authorized hours
- **All data** is stored in a centralized Scheduling database for fast matching operations

### 2. Geocoding & Location Processing
- Addresses are automatically converted to GPS coordinates using Google Maps
- System tracks location precision (exact address vs. approximate)
- Low-quality locations are flagged for manual verification

### 3. Travel Time Optimization
- Uses Google Maps Distance Matrix API to calculate actual travel times
- Considers peak traffic patterns (rush hour vs. off-peak)
- Caches travel times for performance (updates when locations change)

### 4. Matching Algorithm
The system matches clients to RBTs using a multi-factor scoring system:
- **Travel Time**: Prefers matches under 45 minutes
- **Schedule Overlap**: Ensures RBT availability matches client needs
- **Workload Fairness**: Distributes clients evenly across RBTs
- **Quality Filters**: Skips matches with low location confidence

### 5. Admin Controls
- **Manual Overrides**: Lock specific assignments that must stay
- **Block Pairs**: Prevent incompatible matches (e.g., personality conflicts)
- **Approval Workflow**: Review proposed matches before finalizing
- **Sync Management**: Control when client data is refreshed from CRM

## Key Technologies

- **Backend**: Node.js + TypeScript + Express.js
- **Databases**: Supabase (PostgreSQL) - 3 separate databases:
  - Scheduling DB (primary storage)
  - HRM DB (RBT data source)
  - CRM DB (client data source)
- **APIs**: Google Maps (Geocoding + Distance Matrix)
- **Frontend**: Vanilla JavaScript + Tailwind CSS + Google Maps JavaScript API

## Business Value

1. **Time Savings**: Automates hours of manual matching work
2. **Better Matches**: Uses real travel data vs. guessing distances
3. **Fairness**: Ensures no RBT is overloaded while others are underutilized
4. **Flexibility**: Admins can override algorithm when needed
5. **Audit Trail**: Complete history of all matches and decisions
6. **Scalability**: Handles growing client/RBT counts efficiently

## Data Flow

```
CRM Database → [Sync Service] → Scheduling DB
HRM Database → [Direct Query] → Scheduling DB
                                    ↓
                           [Matching Algorithm]
                                    ↓
                              Match Results
                                    ↓
                          [Admin Review/Approval]
                                    ↓
                             Final Assignments
```

## System Highlights

### Intelligent Caching
- Travel times are cached to reduce Google API costs
- Cache automatically invalidates when addresses change
- Supports both optimistic (fast) and pessimistic (conservative) estimates

### Change Detection
- When client addresses change in CRM, system detects it
- Marks coordinates as "stale" and triggers re-geocoding
- Prevents using outdated location data

### Quality Assurance
- Validates matches for location quality
- Flags matches that need manual review
- Tracks confidence scores for all geocoded locations

### Fail-Safe Design
- If CRM database is unavailable, uses last synced data
- Graceful degradation - system continues operating
- Comprehensive error logging and monitoring

## Current Capabilities

✅ Automatic client-RBT matching  
✅ Real-time travel time calculation  
✅ Manual override system  
✅ CRM synchronization  
✅ Location verification workflow  
✅ Interactive dashboard with map visualization  
✅ Match approval/rejection system  
✅ Audit trail and metrics tracking  
✅ Automated scheduling (cron-like jobs)  

## Future Enhancements (Potential)

- Multi-week scheduling planning
- Client priority scoring
- RBT skill matching (specializations)
- Automated notifications
- Mobile app for RBTs
- Integration with calendar systems
