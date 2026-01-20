# Scheduling AI Integration Guide

## Overview

This Scheduling AI system matches Registered Behavior Technicians (RBTs) with clients based on geographic proximity and travel time constraints. This guide explains how to integrate it into your CRM system, set up the Supabase database, and enable full scheduling functionality.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Supabase Database Setup](#supabase-database-setup)
3. [Client Data Integration](#client-data-integration)
4. [RBT Data Integration](#rbt-data-integration)
5. [Matching Algorithm Integration](#matching-algorithm-integration)
6. [Scheduling Functionality](#scheduling-functionality)
7. [CRM Integration Points](#crm-integration-points)
8. [API Endpoints](#api-endpoints)
9. [Frontend Integration](#frontend-integration)

---

## Architecture Overview

### System Components

```
┌─────────────────┐
│   CRM System    │
│  (Main App)     │
└────────┬────────┘
         │
         ├───► Supabase Database
         │     ├── rbt_profiles
         │     ├── clients
         │     ├── matches
         │     └── schedules
         │
         ├───► Scheduling AI Engine
         │     ├── Matcher Algorithm
         │     ├── Google Maps API
         │     └── Travel Time Calculator
         │
         └───► Frontend Dashboard
               ├── Map Visualization
               ├── Match Results
               └── Schedule Management
```

### Data Flow

1. **Data Collection**: RBT and Client data stored in Supabase
2. **Matching Process**: Algorithm calculates optimal matches based on travel time
3. **Schedule Creation**: Matches are converted into scheduled appointments
4. **Visualization**: Dashboard displays matches and routes on interactive map

---

## Supabase Database Setup

### Required Tables

#### 1. `rbt_profiles` Table

```sql
CREATE TABLE rbt_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firstName TEXT NOT NULL,
  lastName TEXT NOT NULL,
  email TEXT UNIQUE,
  phoneNumber TEXT,
  
  -- Location Information
  addressLine1 TEXT,
  addressLine2 TEXT,
  locationCity TEXT,
  locationState TEXT,
  zipCode TEXT,
  lat DECIMAL(10, 8),
  lng DECIMAL(11, 8),
  
  -- Status & Availability
  status TEXT DEFAULT 'ACTIVE', -- ACTIVE, INACTIVE, TERMINATED, etc.
  is_active BOOLEAN DEFAULT true,
  
  -- Transport & Preferences
  transportMode TEXT DEFAULT 'Both', -- 'Car', 'Transit', 'Both'
  gender TEXT, -- 'Male', 'Female'
  
  -- Training & Certification
  fortyHourCourseCompleted BOOLEAN DEFAULT false,
  fortyHourCourseLink TEXT,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_rbt_profiles_status ON rbt_profiles(status);
CREATE INDEX idx_rbt_profiles_is_active ON rbt_profiles(is_active);
CREATE INDEX idx_rbt_profiles_location ON rbt_profiles(lat, lng);
```

#### 2. `clients` Table

```sql
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT, -- 'Active', 'Pending', 'On Hold', etc.
  
  -- Location Information
  address_line TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  locationBorough TEXT, -- 'Brooklyn', 'Queens', 'Manhattan', etc.
  lat DECIMAL(10, 8),
  lng DECIMAL(11, 8),
  needsLocationInfo BOOLEAN DEFAULT false,
  
  -- Contact Information
  phone TEXT,
  email TEXT,
  age INTEGER,
  
  -- Client Details
  insuranceProvider TEXT,
  insuranceId TEXT,
  diagnosis TEXT,
  hoursPerWeek INTEGER,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_clients_status ON clients(status);
CREATE INDEX idx_clients_location ON clients(lat, lng);
CREATE INDEX idx_clients_borough ON clients(locationBorough);
```

#### 3. `matches` Table

```sql
CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  rbt_id UUID REFERENCES rbt_profiles(id) ON DELETE SET NULL,
  
  -- Match Details
  status TEXT DEFAULT 'matched', -- 'matched', 'scheduled', 'completed', 'standby', 'cancelled'
  travelTimeSeconds INTEGER,
  travelTimeMinutes INTEGER,
  distanceMiles DECIMAL(5, 2),
  travelMode TEXT, -- 'driving', 'transit'
  
  -- Scheduling
  scheduledAt TIMESTAMP WITH TIME ZONE,
  completedAt TIMESTAMP WITH TIME ZONE,
  reason TEXT,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(client_id, rbt_id)
);

-- Indexes
CREATE INDEX idx_matches_client ON matches(client_id);
CREATE INDEX idx_matches_rbt ON matches(rbt_id);
CREATE INDEX idx_matches_status ON matches(status);
```

#### 4. `schedules` Table (For Actual Scheduling)

```sql
CREATE TABLE schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  rbt_id UUID REFERENCES rbt_profiles(id) ON DELETE CASCADE,
  
  -- Schedule Details
  scheduled_date DATE NOT NULL,
  start_time TIME NOT NULL, -- 15:00 (3PM) to 21:00 (9PM) only
  end_time TIME NOT NULL,
  duration_hours DECIMAL(3, 2),
  
  -- Status
  status TEXT DEFAULT 'scheduled', -- 'scheduled', 'confirmed', 'in-progress', 'completed', 'cancelled', 'no-show'
  
  -- Location
  service_location TEXT, -- Client address or other location
  travel_time_minutes INTEGER,
  
  -- Notes
  notes TEXT,
  cancellation_reason TEXT,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID, -- Admin user who created the schedule
);

-- Indexes
CREATE INDEX idx_schedules_date ON schedules(scheduled_date);
CREATE INDEX idx_schedules_rbt ON schedules(rbt_id);
CREATE INDEX idx_schedules_client ON schedules(client_id);
CREATE INDEX idx_schedules_status ON schedules(status);

-- Constraint: Ensure scheduling hours are 3PM-9PM
ALTER TABLE schedules ADD CONSTRAINT check_schedule_hours 
  CHECK (EXTRACT(HOUR FROM start_time) >= 15 AND EXTRACT(HOUR FROM end_time) <= 21);
```

### Row Level Security (RLS) Policies

```sql
-- Enable RLS
ALTER TABLE rbt_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;

-- Example policies (adjust based on your auth system)
-- Admins can see all
CREATE POLICY "Admins can view all RBTs" ON rbt_profiles
  FOR SELECT USING (auth.jwt() ->> 'role' = 'admin');

-- RBTs can see their own profile
CREATE POLICY "RBTs can view own profile" ON rbt_profiles
  FOR SELECT USING (auth.uid() = id);
```

---

## Client Data Integration

### Data Sources

Clients can be added to the system through:

1. **CSV Import** (Current Implementation)
   - File: `Clients - Sheet1.csv`
   - Format: Name, Status, Phone, Age, Address, City, State, Zip, etc.

2. **CRM Forms** (Recommended)
   - Client intake form in CRM
   - Direct database insertion via API

3. **API Endpoints**
   - REST API for programmatic client creation
   - Bulk import endpoints

### Client Data Mapping

```typescript
// Example: Client data structure
interface Client {
  id: string;
  name: string;
  status?: string;
  phone?: string;
  age?: number;
  
  // Address components
  address_line?: string;
  city?: string;
  state?: string;
  zip?: string;
  locationBorough?: string; // Critical for matching
  
  // Coordinates (auto-geocoded if not provided)
  lat?: number;
  lng?: number;
  needsLocationInfo: boolean;
  
  // Additional fields
  insuranceProvider?: string;
  insuranceId?: string;
  hoursPerWeek?: number;
}
```

### Geocoding Client Addresses

```typescript
// When a client is created/updated, geocode their address
import { geocodeAddress } from './lib/maps';

async function createClient(clientData: ClientInput) {
  // If lat/lng not provided, geocode the address
  if (!clientData.lat || !clientData.lng) {
    const address = `${clientData.address_line}, ${clientData.city}, ${clientData.state} ${clientData.zip}`;
    const coords = await geocodeAddress(address);
    
    if (coords) {
      clientData.lat = coords.lat;
      clientData.lng = coords.lng;
    } else {
      clientData.needsLocationInfo = true;
    }
  }
  
  // Insert into Supabase
  const { data, error } = await supabase
    .from('clients')
    .insert(clientData)
    .select()
    .single();
    
  return data;
}
```

---

## RBT Data Integration

### Data Sources

1. **Supabase Direct** (Current Implementation)
   - RBTs stored in `rbt_profiles` table
   - Fetched via Supabase client

2. **HRM System Integration**
   - Sync from HRM when RBT is hired
   - Update status when RBT becomes active/inactive

3. **Onboarding Workflow**
   - RBT completes onboarding → status changes to 'ACTIVE'
   - 40-hour course completion tracked

### RBT Data Mapping

```typescript
// Example: RBT data structure
interface RBT {
  id: string;
  full_name: string;
  email?: string;
  phone?: string;
  
  // Location
  address_line?: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number;
  lng?: number;
  
  // Status
  is_active: boolean;
  status: string; // 'ACTIVE', 'INACTIVE', 'TERMINATED', etc.
  
  // Preferences
  transport_mode: 'Car' | 'Transit' | 'Both';
  gender?: 'Male' | 'Female';
  
  // Training
  fortyHourCourseComplete: boolean;
  fortyHourCourseLink?: string;
}
```

### Geocoding RBT Addresses

```typescript
// Similar to clients, geocode RBT addresses
async function updateRBTLocation(rbtId: string) {
  const { data: rbt } = await supabase
    .from('rbt_profiles')
    .select('*')
    .eq('id', rbtId)
    .single();
    
  if (!rbt.lat || !rbt.lng) {
    const address = `${rbt.addressLine1}, ${rbt.locationCity}, ${rbt.locationState} ${rbt.zipCode}`;
    const coords = await geocodeAddress(address);
    
    if (coords) {
      await supabase
        .from('rbt_profiles')
        .update({ lat: coords.lat, lng: coords.lng })
        .eq('id', rbtId);
    }
  }
}
```

---

## Matching Algorithm Integration

### How Matching Works

1. **Input**: List of active clients and active RBTs
2. **Process**: For each client, find the closest RBT within 30 minutes travel time
3. **Output**: Matches with travel time, distance, and route information

### Matching Logic

```typescript
// Core matching function
async function matchClientsToRBTs(
  clients: Client[],
  rbts: RBT[]
): Promise<ClientMatch[]> {
  const matches: ClientMatch[] = [];
  const matchedRBTIds = new Set<string>(); // 1-to-1 matching
  
  for (const client of clients) {
    // Skip clients without location
    if (client.needsLocationInfo || !client.lat || !client.lng) {
      matches.push({
        client,
        rbt: null,
        status: 'no_location',
        reason: 'Missing location information'
      });
      continue;
    }
    
    let bestRBT: RBT | null = null;
    let bestTravelTime: number | null = null;
    let bestDistance: number | null = null;
    
    for (const rbt of rbts) {
      // Skip if RBT already matched
      if (matchedRBTIds.has(rbt.id)) continue;
      
      // Skip if RBT has no location
      if (!rbt.lat || !rbt.lng) continue;
      
      // Calculate travel time based on RBT's transport mode
      const travelTime = await getTravelTime(
        { lat: client.lat, lng: client.lng },
        { lat: rbt.lat, lng: rbt.lng },
        rbt.transport_mode
      );
      
      // Must be within 30 minutes
      if (travelTime && travelTime <= 1800) { // 30 minutes in seconds
        if (!bestTravelTime || travelTime < bestTravelTime) {
          bestRBT = rbt;
          bestTravelTime = travelTime;
          bestDistance = calculateDistance(client, rbt);
        }
      }
    }
    
    if (bestRBT && bestTravelTime) {
      matches.push({
        client,
        rbt: bestRBT,
        travelTimeSeconds: bestTravelTime,
        travelTimeMinutes: Math.round(bestTravelTime / 60),
        distanceMiles: bestDistance,
        status: 'matched'
      });
      matchedRBTIds.add(bestRBT.id);
    } else {
      matches.push({
        client,
        rbt: null,
        status: 'standby',
        reason: 'No RBT within 30 minutes'
      });
    }
  }
  
  return matches;
}
```

### Transport Mode Handling

```typescript
// HYBRID mode: Try both driving and transit, pick the best
if (rbt.transport_mode === 'Both') {
  const drivingTime = await getTravelTime(origin, destination, 'driving');
  const transitTime = await getTravelTime(origin, destination, 'transit');
  
  // Pick the shortest valid route (≤ 30 min)
  if (drivingTime && drivingTime <= 1800 && transitTime && transitTime <= 1800) {
    travelTime = Math.min(drivingTime, transitTime);
  } else if (drivingTime && drivingTime <= 1800) {
    travelTime = drivingTime;
  } else if (transitTime && transitTime <= 1800) {
    travelTime = transitTime;
  }
}
```

---

## Scheduling Functionality

### Converting Matches to Schedules

Once matches are created, they need to be converted into actual scheduled appointments:

```typescript
async function createScheduleFromMatch(
  matchId: string,
  scheduledDate: Date,
  startTime: string, // "15:00" format
  durationHours: number
) {
  const match = await getMatch(matchId);
  
  // Validate time is between 3PM-9PM
  const hour = parseInt(startTime.split(':')[0]);
  if (hour < 15 || hour > 21) {
    throw new Error('Scheduling only allowed between 3PM and 9PM');
  }
  
  // Calculate end time
  const endTime = addHours(startTime, durationHours);
  
  // Create schedule entry
  const { data, error } = await supabase
    .from('schedules')
    .insert({
      match_id: matchId,
      client_id: match.client_id,
      rbt_id: match.rbt_id,
      scheduled_date: scheduledDate.toISOString().split('T')[0],
      start_time: startTime,
      end_time: endTime,
      duration_hours: durationHours,
      travel_time_minutes: match.travelTimeMinutes,
      service_location: match.client.address_line,
      status: 'scheduled'
    })
    .select()
    .single();
    
  // Update match status
  await supabase
    .from('matches')
    .update({ 
      status: 'scheduled',
      scheduledAt: new Date().toISOString()
    })
    .eq('id', matchId);
    
  return data;
}
```

### Schedule Management

```typescript
// Get schedules for an RBT
async function getRBTSchedules(rbtId: string, startDate: Date, endDate: Date) {
  const { data, error } = await supabase
    .from('schedules')
    .select(`
      *,
      client:clients(*),
      match:matches(*)
    `)
    .eq('rbt_id', rbtId)
    .gte('scheduled_date', startDate.toISOString().split('T')[0])
    .lte('scheduled_date', endDate.toISOString().split('T')[0])
    .order('scheduled_date', { ascending: true })
    .order('start_time', { ascending: true });
    
  return data;
}

// Update schedule status
async function updateScheduleStatus(
  scheduleId: string,
  status: 'confirmed' | 'in-progress' | 'completed' | 'cancelled' | 'no-show',
  notes?: string
) {
  const updateData: any = { status, updated_at: new Date().toISOString() };
  
  if (status === 'completed') {
    updateData.completedAt = new Date().toISOString();
  }
  
  if (notes) {
    updateData.notes = notes;
  }
  
  const { data, error } = await supabase
    .from('schedules')
    .update(updateData)
    .eq('id', scheduleId)
    .select()
    .single();
    
  return data;
}
```

---

## CRM Integration Points

### 1. User Authentication

```typescript
// Use Supabase Auth for CRM users
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Login
async function login(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  return { user: data.user, error };
}

// Check user role (admin, scheduler, rbt, etc.)
async function getUserRole(userId: string) {
  const { data } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .single();
  return data?.role;
}
```

### 2. Dashboard Integration

```typescript
// Add scheduling dashboard to CRM navigation
// Route: /crm/scheduling

// Component structure:
<SchedulingDashboard>
  <KPICards />
  <MapSection />
  <MatchResults />
  <ScheduleCalendar />
</SchedulingDashboard>
```

### 3. Client Management Integration

```typescript
// When a new client is added in CRM:
async function onClientCreated(clientData: ClientInput) {
  // 1. Create client in database
  const client = await createClient(clientData);
  
  // 2. Geocode address
  await geocodeClientAddress(client.id);
  
  // 3. Trigger matching (optional - can be manual)
  // await triggerMatching();
  
  // 4. Show notification
  showNotification('Client created. Ready for matching.');
}
```

### 4. RBT Management Integration

```typescript
// When RBT status changes:
async function onRBTStatusChanged(rbtId: string, newStatus: string) {
  // Update status
  await supabase
    .from('rbt_profiles')
    .update({ status: newStatus, is_active: newStatus === 'ACTIVE' })
    .eq('id', rbtId);
    
  // If RBT becomes inactive, unassign from matches
  if (newStatus !== 'ACTIVE') {
    await supabase
      .from('matches')
      .update({ status: 'standby', rbt_id: null })
      .eq('rbt_id', rbtId)
      .eq('status', 'matched');
  }
}
```

---

## API Endpoints

### Recommended API Structure

```typescript
// API Routes (Next.js example)

// POST /api/scheduling/match
// Run matching algorithm
export async function POST(request: Request) {
  const clients = await getActiveClients();
  const rbts = await getActiveRBTs();
  const matches = await matchClientsToRBTs(clients, rbts);
  
  // Save matches to database
  await saveMatches(matches);
  
  return Response.json({ matches });
}

// GET /api/scheduling/matches
// Get all matches with filters
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const clientId = searchParams.get('clientId');
  const rbtId = searchParams.get('rbtId');
  
  const matches = await getMatches({ status, clientId, rbtId });
  return Response.json({ matches });
}

// POST /api/scheduling/schedules
// Create schedule from match
export async function POST(request: Request) {
  const { matchId, scheduledDate, startTime, durationHours } = await request.json();
  const schedule = await createScheduleFromMatch(matchId, scheduledDate, startTime, durationHours);
  return Response.json({ schedule });
}

// GET /api/scheduling/schedules
// Get schedules with date range
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const rbtId = searchParams.get('rbtId');
  
  const schedules = await getSchedules({ startDate, endDate, rbtId });
  return Response.json({ schedules });
}
```

---

## Frontend Integration

### 1. Embedding the Dashboard

```tsx
// In your CRM app
import SchedulingDashboard from '@/components/scheduling/Dashboard';

export default function SchedulingPage() {
  return (
    <div className="crm-layout">
      <Sidebar />
      <MainContent>
        <SchedulingDashboard />
      </MainContent>
    </div>
  );
}
```

### 2. Using the Match Data

```typescript
// Fetch matches from API
async function loadMatches() {
  const response = await fetch('/api/scheduling/matches');
  const { matches } = await response.json();
  return matches;
}

// Display in your CRM interface
function MatchList({ matches }) {
  return (
    <div>
      {matches.map(match => (
        <MatchCard
          key={match.id}
          client={match.client}
          rbt={match.rbt}
          travelTime={match.travelTimeMinutes}
          onSchedule={() => openScheduleModal(match)}
        />
      ))}
    </div>
  );
}
```

### 3. Schedule Calendar Integration

```typescript
// Integrate with your calendar component
function ScheduleCalendar() {
  const schedules = useSchedules();
  
  return (
    <Calendar
      events={schedules.map(s => ({
        id: s.id,
        title: `${s.client.name} - ${s.rbt.name}`,
        start: `${s.scheduled_date}T${s.start_time}`,
        end: `${s.scheduled_date}T${s.end_time}`,
        color: getStatusColor(s.status)
      }))}
      onEventClick={handleScheduleClick}
    />
  );
}
```

---

## Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key

# Google Maps
GOOGLE_MAPS_API_KEY=your-google-maps-api-key

# Optional: For email notifications
SMTP_HOST=smtp.example.com
SMTP_USER=your-email@example.com
SMTP_PASS=your-password
```

---

## Next Steps

1. **Set up Supabase tables** using the SQL schemas above
2. **Configure RLS policies** based on your authentication system
3. **Import existing data** from your current systems
4. **Set up geocoding** for all addresses (one-time batch job)
5. **Integrate matching API** into your CRM workflow
6. **Build schedule management UI** using the schedule data structure
7. **Add notifications** for new matches and schedule changes
8. **Set up automated matching** (daily/weekly runs)

---

## Support & Maintenance

- **Regular Updates**: Run matching algorithm when new clients/RBTs are added
- **Geocoding**: Keep addresses geocoded as they're updated
- **Performance**: Index database tables for fast queries
- **Monitoring**: Track match success rates and travel times

---

## Questions?

For integration support, refer to:
- Supabase Documentation: https://supabase.com/docs
- Google Maps API: https://developers.google.com/maps/documentation
- This codebase: See `src/lib/scheduling/matcher.ts` for matching logic

