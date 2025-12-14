import type { Client } from '../clients';
import type { RBT } from '../rbts';
import type { LatLng } from '../maps';
import { getTravelTimeSeconds, geocodeAddress } from '../maps';

export type ClientMatch = {
  client: Client;
  rbt: RBT | null;
  travelTimeSeconds: number | null;
  travelTimeMinutes: number | null;
  distanceMiles: number | null;
  reason?: string;
  status: 'matched' | 'standby' | 'no_location' | 'scheduled' | 'completed';
  travelMode?: 'driving' | 'transit'; // Selected travel mode for this match
  scheduledAt?: string; // ISO date string when scheduled
  completedAt?: string; // ISO date string when completed
};

const MAX_TRAVEL_TIME_SECONDS = 30 * 60; // 30 minutes

/**
 * Ensures a location has lat/lng coordinates
 */
async function ensureCoordinates(
  item: Client | RBT,
  address: string
): Promise<LatLng | null> {
  if (item.lat && item.lng) {
    return { lat: item.lat, lng: item.lng };
  }

  // Try to geocode
  if (address) {
    return await geocodeAddress(address);
  }

  return null;
}

/**
 * Builds full address string from components
 */
function buildAddress(item: Client | RBT): string {
  const parts: string[] = [];
  
  if ('address_line' in item && item.address_line) {
    parts.push(item.address_line);
  }
  if ('city' in item && item.city) {
    parts.push(item.city);
  }
  if ('state' in item && item.state) {
    parts.push(item.state);
  }
  if ('zip' in item && item.zip) {
    parts.push(item.zip);
  }

  // For RBTs, if we only have city/state, try to use locationBorough as fallback
  const locationBorough = ('locationBorough' in item) ? item.locationBorough : '';
  const address = parts.join(', ');
  
  // If address is too vague (just city/state), try to use borough or return empty to force geocoding
  if (address && address.split(',').length >= 2) {
    return address;
  }
  
  return address || locationBorough || '';
}

/**
 * Matches clients to RBTs based on travel time
 */
export async function matchClientsToRBTs(
  clients: Client[],
  rbts: RBT[]
): Promise<ClientMatch[]> {
  const matches: ClientMatch[] = [];
  const travelTimeCache = new Map<string, number>(); // Cache for travel times

  console.log(`\n🔍 Starting matching process...`);
  console.log(`   Clients: ${clients.length}`);
  console.log(`   RBTs: ${rbts.length}`);
  
  // Log RBT address info for debugging
  console.log(`\n📋 RBT Address Summary:`);
  rbts.forEach(rbt => {
    const addr = buildAddress(rbt);
    const hasCoords = rbt.lat && rbt.lng;
    console.log(`   ${rbt.full_name}: ${addr || 'NO ADDRESS'} ${hasCoords ? `(has lat/lng: ${rbt.lat}, ${rbt.lng})` : '(no lat/lng)'}`);
  });

  // Separate clients with and without location info
  const clientsWithLocation = clients.filter(c => !c.needsLocationInfo && c.locationBorough !== 'Unknown');
  const clientsWithoutLocation = clients.filter(c => c.needsLocationInfo || c.locationBorough === 'Unknown');

  console.log(`   Clients with location: ${clientsWithLocation.length}`);
  console.log(`   Clients without location: ${clientsWithoutLocation.length} (set aside for later)`);

  // Track which RBTs have been matched (to ensure 1 client per RBT)
  const matchedRBTIds = new Set<string>();

  // Process clients with location
  for (const client of clientsWithLocation) {
    const clientAddress = buildAddress(client);
    const clientCoords = await ensureCoordinates(client, clientAddress);

    if (!clientCoords) {
      matches.push({
        client,
        rbt: null,
        travelTimeSeconds: null,
        travelTimeMinutes: null,
        distanceMiles: null,
        reason: 'Could not geocode client address',
        status: 'no_location'
      });
      continue;
    }

    // Find best matching RBT
    let bestRBT: RBT | null = null;
    let bestTravelTime: number | null = null;
    let bestDistance: number | null = null;

    for (const rbt of rbts) {
      // Skip RBTs that are already matched to another client
      if (matchedRBTIds.has(rbt.id)) {
        continue;
      }

      const rbtAddress = buildAddress(rbt);
      const rbtCoords = await ensureCoordinates(rbt, rbtAddress);

      if (!rbtCoords) {
        console.log(`   ⚠️  Skipping RBT ${rbt.full_name}: No valid coordinates (address: "${rbtAddress}")`);
        continue; // Skip RBTs without valid coordinates
      }

      // Determine travel mode from RBT transport_mode
      const transportMode = rbt.transport_mode || 'Both';
      
      let travelTime: number | null = null;
      let selectedMode: 'driving' | 'transit' = 'driving';
      
      if (transportMode === 'Both') {
        // HYBRID mode: test both driving and transit, pick the best
        const drivingCacheKey = `${clientCoords.lat},${clientCoords.lng}-${rbtCoords.lat},${rbtCoords.lng}-driving`;
        const transitCacheKey = `${clientCoords.lat},${clientCoords.lng}-${rbtCoords.lat},${rbtCoords.lng}-transit`;
        
        let drivingTime = travelTimeCache.get(drivingCacheKey) ?? null;
        let transitTime = travelTimeCache.get(transitCacheKey) ?? null;
        
        // Fetch driving time if not cached
        if (drivingTime === null) {
          drivingTime = await getTravelTimeSeconds(clientCoords, rbtCoords, 'driving');
          if (drivingTime !== null) {
            travelTimeCache.set(drivingCacheKey, drivingTime);
          }
        }
        
        // Fetch transit time if not cached
        if (transitTime === null) {
          transitTime = await getTravelTimeSeconds(clientCoords, rbtCoords, 'transit');
          if (transitTime !== null) {
            travelTimeCache.set(transitCacheKey, transitTime);
          }
        }
        
        // Pick the best route that's ≤ 30 minutes
        const validDriving = drivingTime !== null && drivingTime <= MAX_TRAVEL_TIME_SECONDS;
        const validTransit = transitTime !== null && transitTime <= MAX_TRAVEL_TIME_SECONDS;
        
        if (validDriving && validTransit) {
          // Both valid - pick the shorter one
          if (drivingTime !== null && transitTime !== null && drivingTime <= transitTime) {
            travelTime = drivingTime;
            selectedMode = 'driving';
          } else if (transitTime !== null) {
            travelTime = transitTime;
            selectedMode = 'transit';
          } else {
            continue;
          }
        } else if (validDriving && drivingTime !== null) {
          travelTime = drivingTime;
          selectedMode = 'driving';
        } else if (validTransit && transitTime !== null) {
          travelTime = transitTime;
          selectedMode = 'transit';
        } else {
          // Neither valid - skip this RBT
          continue;
        }
      } else if (transportMode === 'Car') {
        // Single mode: DRIVING
        const cacheKey = `${clientCoords.lat},${clientCoords.lng}-${rbtCoords.lat},${rbtCoords.lng}-driving`;
        travelTime = travelTimeCache.get(cacheKey) ?? null;
        
        if (travelTime === null) {
          travelTime = await getTravelTimeSeconds(clientCoords, rbtCoords, 'driving');
          if (travelTime !== null) {
            travelTimeCache.set(cacheKey, travelTime);
          }
        }
        
        selectedMode = 'driving';
        
        if (travelTime === null || travelTime > MAX_TRAVEL_TIME_SECONDS) {
          continue; // Skip if travel time is too long
        }
      } else if (transportMode === 'Transit') {
        // Single mode: TRANSIT
        const cacheKey = `${clientCoords.lat},${clientCoords.lng}-${rbtCoords.lat},${rbtCoords.lng}-transit`;
        travelTime = travelTimeCache.get(cacheKey) ?? null;
        
        if (travelTime === null) {
          travelTime = await getTravelTimeSeconds(clientCoords, rbtCoords, 'transit');
          if (travelTime !== null) {
            travelTimeCache.set(cacheKey, travelTime);
          }
        }
        
        selectedMode = 'transit';
        
        if (travelTime === null || travelTime > MAX_TRAVEL_TIME_SECONDS) {
          continue; // Skip if travel time is too long
        }
      } else {
        // Default to driving if transport mode is not recognized
        const cacheKey = `${clientCoords.lat},${clientCoords.lng}-${rbtCoords.lat},${rbtCoords.lng}-driving`;
        travelTime = travelTimeCache.get(cacheKey) ?? null;
        
        if (travelTime === null) {
          travelTime = await getTravelTimeSeconds(clientCoords, rbtCoords, 'driving');
          if (travelTime !== null) {
            travelTimeCache.set(cacheKey, travelTime);
          }
        }
        
        selectedMode = 'driving';
        
        if (travelTime === null || travelTime > MAX_TRAVEL_TIME_SECONDS) {
          continue; // Skip if travel time is too long
        }
      }

      // Calculate distance
      const distance = calculateDistance(clientCoords, rbtCoords);

      // Update best match if this is closer
      if (bestTravelTime === null || travelTime < bestTravelTime) {
        bestRBT = rbt;
        bestTravelTime = travelTime;
        bestDistance = distance;
        // Store selected mode for this match
        (rbt as any).selectedTravelMode = selectedMode;
      }
    }

    if (bestRBT && bestTravelTime !== null && bestTravelTime !== undefined) {
      // Mark this RBT as matched
      matchedRBTIds.add(bestRBT.id);
      
      matches.push({
        client,
        rbt: bestRBT,
        travelTimeSeconds: bestTravelTime,
        travelTimeMinutes: Math.round(bestTravelTime / 60),
        distanceMiles: bestDistance ? parseFloat(bestDistance.toFixed(1)) : null,
        reason: `Matched - ${Math.round(bestTravelTime / 60)} min travel time`,
        status: 'matched'
      });
      console.log(`   ✅ ${client.name} → ${bestRBT.full_name} (${Math.round(bestTravelTime / 60)} min)`);
    } else {
      matches.push({
        client,
        rbt: null,
        travelTimeSeconds: null,
        travelTimeMinutes: null,
        distanceMiles: null,
        reason: 'No RBT within 30 minutes',
        status: 'standby'
      });
      console.log(`   ⏳ ${client.name} → No match (standby)`);
    }
  }

  // Add clients without location as "no_location" status
  for (const client of clientsWithoutLocation) {
    matches.push({
      client,
      rbt: null,
      travelTimeSeconds: null,
      travelTimeMinutes: null,
      distanceMiles: null,
      reason: 'Missing location information - set aside for later',
      status: 'no_location'
    });
    console.log(`   ⚠️  ${client.name} → Missing location (set aside)`);
  }

  return matches;
}

/**
 * Calculates distance between two coordinates in miles
 */
function calculateDistance(origin: LatLng, destination: LatLng): number {
  const R = 3959; // Earth radius in miles
  const dLat = (destination.lat - origin.lat) * Math.PI / 180;
  const dLon = (destination.lng - origin.lng) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(origin.lat * Math.PI / 180) * Math.cos(destination.lat * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

