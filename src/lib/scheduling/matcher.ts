/**
 * Client-RBT Matching Algorithm
 * 
 * Matches clients to RBTs based on travel time constraints using cached travel times.
 * Includes validation and quality checks.
 */

import type { Client } from '../clients';
import type { RBT, GeocodePrecision, GeocodeSource } from '../rbts';
import { getCachedTravelTime } from './travelTimeCache';
import { validateMatch, getLocationQuality } from './validation';
import { geocodeWithPrecision } from '../geocoding/geocode';
import { config, getMatchMaxTravelMinutes, getPeakBucketName } from '../config';
import { updateClientGeocoding } from '../clients';
import { updateRBTGeocoding } from '../rbts';

export type ClientMatch = {
  client: Client;
  rbt: RBT | null;
  travelTimeSeconds: number | null;
  travelTimeMinutes: number | null;
  distanceMiles: number | null;
  reason?: string;
  status: 'matched' | 'standby' | 'no_location' | 'scheduled' | 'completed' | 'needs_review';
  travelMode?: 'driving' | 'transit';
  scheduledAt?: string;
  completedAt?: string;
  // Validation fields
  needsReview?: boolean;
  reviewReason?: string;
  warnings?: string[];
  matchQuality?: number;
  // Override fields
  source?: 'AUTO' | 'LOCKED' | 'MANUAL';
  locked?: boolean;
  // Explain object for transparency
  explain?: {
    chosenMode: 'driving' | 'transit';
    travelTimeMin: number;
    distanceMiles: number | null;
    bucket: string;
    samples: Array<{
      departureLocal: string;
      durationMin: number;
      distanceMiles: number | null;
      source: 'cache' | 'google';
    }>;
    flags: string[];
  };
};

export interface MatchingResult {
  matches: ClientMatch[];
  googleApiCalls: number;
  cacheHits: number;
  blockedCount: number;
  lockedCount: number;
  autoCount: number;
  manualCount: number;
}

const MAX_TRAVEL_TIME_SECONDS = getMatchMaxTravelMinutes() * 60;

/**
 * Ensures a location has lat/lng coordinates, geocoding if needed and saving to DB
 */
async function ensureCoordinates(
  item: Client | RBT,
  address: string
): Promise<{ lat: number; lng: number } | null> {
  // If already has coordinates, return them
  if (item.lat && item.lng) {
    return { lat: item.lat, lng: item.lng };
  }

  // For clients, prioritize location_borough + zip combination for better NYC accuracy
  let addressToGeocode = address;
  if ('locationBorough' in item && item.locationBorough && item.locationBorough !== 'Unknown') {
    // Build a more specific address using borough + zip for better NYC accuracy
    if (item.zip && item.zip.trim() !== '') {
      // Use "Borough, NY ZIP" format - this ensures Google geocodes to the right borough/zip area
      // Example: "Brooklyn, NY 11214" instead of just "11214" which might geocode to center of zip
      addressToGeocode = `${item.locationBorough}, NY ${item.zip}`;
      console.log(`   Using borough+zip geocoding for ${item.name}: "${addressToGeocode}"`);
    } else if (address) {
      // Fallback: ensure borough is in the address
      const addressLower = address.toLowerCase();
      const boroughLower = item.locationBorough.toLowerCase();
      if (!addressLower.includes(boroughLower)) {
        // Borough not in address, prepend it
        if (item.state) {
          addressToGeocode = `${item.locationBorough}, ${item.state}${address ? ', ' + address : ''}`;
        } else {
          addressToGeocode = `${item.locationBorough}, NY${address ? ', ' + address : ''}`;
        }
        console.log(`   Added borough to address for ${item.name}: "${addressToGeocode}"`);
      }
    } else {
      // Last resort: just borough + NY
      addressToGeocode = `${item.locationBorough}, NY`;
      console.log(`   Using borough-only geocoding for ${item.name}: "${addressToGeocode}"`);
    }
  }

  // Try to geocode using precision tracking
  if (addressToGeocode) {
    const geocodeResult = await geocodeWithPrecision(addressToGeocode);
    
    if ('error' in geocodeResult) {
      console.warn(`   Geocoding failed for ${'name' in item ? item.name : item.full_name}: ${geocodeResult.message}`);
      // For clients without zip, try a fallback with just borough
      if ('locationBorough' in item && item.locationBorough && item.locationBorough !== 'Unknown' && !item.zip) {
        const fallbackAddress = `${item.locationBorough}, NY, USA`;
        console.log(`   Trying fallback geocoding: ${fallbackAddress}`);
        const fallbackResult = await geocodeWithPrecision(fallbackAddress);
        if (!('error' in fallbackResult)) {
          // Use fallback result
          const geocodeResult = fallbackResult;
          // Save to DB and update in memory (same code as below)
          if ('locationBorough' in item) {
            // Type narrowed to Client
            const client = item as Client;
            await updateClientGeocoding(
              client.id,
              geocodeResult.lat,
              geocodeResult.lng,
              geocodeResult.precision,
              geocodeResult.confidence,
              geocodeResult.source,
              geocodeResult.addressUsed
            );
          } else {
            // Type narrowed to RBT
            const rbt = item as RBT;
            await updateRBTGeocoding(
              rbt.id,
              geocodeResult.lat,
              geocodeResult.lng,
              geocodeResult.precision,
              geocodeResult.confidence,
              geocodeResult.source,
              geocodeResult.addressUsed
            );
          }
          
          item.lat = geocodeResult.lat;
          item.lng = geocodeResult.lng;
          item.geocode_precision = geocodeResult.precision;
          item.geocode_confidence = geocodeResult.confidence;
          item.geocode_source = geocodeResult.source;
          item.geocode_address_used = geocodeResult.addressUsed;
          return { lat: geocodeResult.lat, lng: geocodeResult.lng };
        }
      }
      return null;
    }

    // Save geocoded result back to database
    if ('locationBorough' in item) {
      // Type narrowed to Client
      const client = item as Client;
      await updateClientGeocoding(
        client.id,
        geocodeResult.lat,
        geocodeResult.lng,
        geocodeResult.precision,
        geocodeResult.confidence,
        geocodeResult.source,
        geocodeResult.addressUsed
      );
    } else {
      // Type narrowed to RBT
      const rbt = item as RBT;
      await updateRBTGeocoding(
        rbt.id,
        geocodeResult.lat,
        geocodeResult.lng,
        geocodeResult.precision,
        geocodeResult.confidence,
        geocodeResult.source,
        geocodeResult.addressUsed
      );
    }
    
    // Update item in memory
    item.lat = geocodeResult.lat;
    item.lng = geocodeResult.lng;
    item.geocode_precision = geocodeResult.precision;
    item.geocode_confidence = geocodeResult.confidence;
    item.geocode_source = geocodeResult.source;
    item.geocode_address_used = geocodeResult.addressUsed;

    return { lat: geocodeResult.lat, lng: geocodeResult.lng };
  }

  return null;
}

/**
 * Builds full address string from components
 * For clients, prioritizes location_borough (e.g., "Brooklyn") for better NYC accuracy
 */
function buildAddress(item: Client | RBT): string {
  const parts: string[] = [];
  
  // For clients, use location_borough if available (more accurate for NYC)
  if ('locationBorough' in item && item.locationBorough && item.locationBorough !== 'Unknown') {
    // If we have location_borough, use it as the city
    if ('address_line' in item && item.address_line) {
      parts.push(item.address_line);
    }
    // Use location_borough as city (e.g., "Brooklyn")
    parts.push(item.locationBorough);
    // Use state if available, default to NY for NYC boroughs
    if ('state' in item && item.state) {
      parts.push(item.state);
    } else {
      parts.push('NY');
    }
    // Add ZIP if available
    if ('zip' in item && item.zip) {
      parts.push(item.zip);
    }
  } else {
    // Standard address building for RBTs or clients without borough
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
  }

  const address = parts.join(', ');
  
  // If we have at least borough/zip or city/state/zip, it's usable
  if (address && (address.includes(',') || address.includes(' '))) {
    return address;
  }
  
  // Last resort: return location_borough if nothing else works
  const locationBorough = ('locationBorough' in item) ? item.locationBorough : '';
  if (locationBorough && locationBorough !== 'Unknown') {
    return `${locationBorough}, NY`; // Default to NY for NYC boroughs
  }
  
  return address || '';
}

/**
 * Determines allowed travel modes based on RBT transport preference
 */
function getAllowedModes(transportMode: 'Car' | 'Transit' | 'Both'): ('driving' | 'transit')[] {
  if (transportMode === 'Car') return ['driving'];
  if (transportMode === 'Transit') return ['transit'];
  return ['driving', 'transit']; // Both
}

/**
 * Matches clients to RBTs based on travel time
 * Honors locked assignments and blocked pairs from overrides
 */
export async function matchClientsToRBTs(
  clients: Client[],
  rbts: RBT[]
): Promise<ClientMatch[]> {
  const result = await matchClientsToRBTsWithMetrics(clients, rbts);
  return result.matches;
}

/**
 * Matches clients to RBTs with detailed metrics
 * Honors locked assignments and blocked pairs from overrides
 */
export async function matchClientsToRBTsWithMetrics(
  clients: Client[],
  rbts: RBT[]
): Promise<MatchingResult> {
  const matches: ClientMatch[] = [];
  let googleApiCalls = 0;
  let cacheHits = 0;
  let blockedCount = 0;
  let lockedCount = 0;
  let autoCount = 0;
  let manualCount = 0;

  console.log(`\n🔍 Starting matching process...`);
  console.log(`   Clients: ${clients.length}`);
  console.log(`   RBTs: ${rbts.length}`);
  console.log(`   Max travel time: ${getMatchMaxTravelMinutes()} minutes`);
  console.log(`   Peak bucket: ${getPeakBucketName()}`);
  
  // Load overrides
  const { getBlockedPairs, getLockedAssignmentIds } = await import('./overrides');
  const blockedPairs = await getBlockedPairs();
  const lockedAssignments = await getLockedAssignmentIds();
  
  console.log(`   🔒 Locked assignments: ${lockedAssignments.length}`);
  console.log(`   🚫 Blocked pairs: ${blockedPairs.size}`);

  // Log RBT address info for debugging
  console.log(`\n📋 RBT Address Summary:`);
  rbts.slice(0, 5).forEach(rbt => {
    const addr = buildAddress(rbt);
    const hasCoords = rbt.lat && rbt.lng;
    const quality = getLocationQuality(rbt.geocode_precision, rbt.geocode_confidence, rbt.geocode_source);
    console.log(`   ${rbt.full_name}: ${addr || 'NO ADDRESS'} ${hasCoords ? `[${quality}]` : '(no coords)'}`);
  });
  if (rbts.length > 5) {
    console.log(`   ... and ${rbts.length - 5} more`);
  }

  // Separate clients with and without location info
  // For clients: need location_borough OR zip (borough is sufficient for NYC geocoding)
  const clientsWithLocation = clients.filter(c => {
    const hasBorough = c.locationBorough && c.locationBorough !== 'Unknown';
    const hasZip = c.zip && c.zip.trim() !== '';
    // Client needs at least borough (for NYC) or zip to be geocodable
    return (hasBorough || hasZip) && !c.needsLocationInfo;
  });
  const clientsWithoutLocation = clients.filter(c => {
    const hasBorough = c.locationBorough && c.locationBorough !== 'Unknown';
    const hasZip = c.zip && c.zip.trim() !== '';
    // Client needs at least borough or zip
    return (!hasBorough && !hasZip) || c.needsLocationInfo || c.locationBorough === 'Unknown';
  });

  console.log(`   Clients with location: ${clientsWithLocation.length}`);
  console.log(`   Clients without location: ${clientsWithoutLocation.length} (set aside for later)`);

  // Track which RBTs and clients have been matched
  const matchedRBTIds = new Set<string>();
  const matchedClientIds = new Set<string>();

  // Apply LOCKED_ASSIGNMENT first
  console.log(`\n🔒 Applying locked assignments...`);
  for (const locked of lockedAssignments) {
    const client = clients.find(c => c.id === locked.clientId);
    const rbt = rbts.find(r => r.id === locked.rbtId);
    
    if (client && rbt) {
      // Check if pair is blocked (shouldn't happen, but safety check)
      if (blockedPairs.has(`${locked.clientId}:${locked.rbtId}`)) {
        console.warn(`   ⚠️ Locked assignment ${client.name} → ${rbt.full_name} is also blocked - skipping`);
        blockedCount++;
        continue;
      }
      
      // Create locked match
      const clientAddress = buildAddress(client);
      const clientCoords = await ensureCoordinates(client, clientAddress);
      const rbtAddress = buildAddress(rbt);
      const rbtCoords = await ensureCoordinates(rbt, rbtAddress);
      
      let travelTimeSeconds: number | null = null;
      let travelTimeMinutes: number | null = null;
      let distanceMiles: number | null = null;
      let travelMode: 'driving' | 'transit' | undefined = undefined;
      
      // Calculate travel time if both have coordinates
      if (clientCoords && rbtCoords) {
        const transportMode = rbt.transport_mode || 'Both';
        const allowedModes = getAllowedModes(transportMode);
        
        let bestTravelTime: number | null = null;
        let bestMode: 'driving' | 'transit' = 'driving';
        
        for (const mode of allowedModes) {
          const travelResult = await getCachedTravelTime({
            originLat: rbtCoords.lat,
            originLng: rbtCoords.lng,
            destLat: clientCoords.lat,
            destLng: clientCoords.lng,
            mode,
            originId: rbt.id,
            originType: 'rbt',
            destId: client.id,
            destType: 'client',
          });
          
          if (travelResult) {
            if (travelResult.fromCache) {
              cacheHits++;
            } else {
              googleApiCalls += travelResult.samples?.length || 1;
            }
            
            const durationSec = travelResult.durationSecPessimistic;
            if (bestTravelTime === null || durationSec < bestTravelTime) {
              bestTravelTime = durationSec;
              bestMode = mode;
            }
          }
        }
        
        if (bestTravelTime !== null) {
          travelTimeSeconds = bestTravelTime;
          travelTimeMinutes = Math.round(bestTravelTime / 60);
          travelMode = bestMode;
          
          // Calculate distance
          if (rbtCoords && clientCoords) {
            distanceMiles = calculateDistance(clientCoords, rbtCoords);
          }
        }
      }
      
      const lockedMatch: ClientMatch = {
        client,
        rbt,
        travelTimeSeconds,
        travelTimeMinutes,
        distanceMiles,
        reason: travelTimeMinutes ? `Locked assignment - ${travelTimeMinutes} min travel time` : 'Locked assignment',
        status: 'matched',
        travelMode,
        source: 'LOCKED',
        locked: true,
      };
      
      matches.push(lockedMatch);
      matchedRBTIds.add(rbt.id);
      matchedClientIds.add(client.id);
      lockedCount++;
      
      console.log(`   ✅ ${client.name} → ${rbt.full_name} (LOCKED)`);
    }
  }
  
  // Filter out locked clients and RBTs from available pools
  const availableClients = clientsWithLocation.filter(c => !matchedClientIds.has(c.id));
  const availableRBTs = rbts.filter(r => !matchedRBTIds.has(r.id));
  
  console.log(`\n🔍 Running auto-matching on ${availableClients.length} remaining clients...`);

  // Process remaining clients with location (auto-matching)
  for (const client of availableClients) {
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
    let bestMode: 'driving' | 'transit' = 'driving';
    let bestTravelResult: any = null;

    for (const rbt of availableRBTs) {
      // Check if pair is blocked
      if (blockedPairs.has(`${client.id}:${rbt.id}`)) {
        blockedCount++;
        continue;
      }

      const rbtAddress = buildAddress(rbt);
      const rbtCoords = await ensureCoordinates(rbt, rbtAddress);

      if (!rbtCoords) {
        continue;
      }

      const transportMode = rbt.transport_mode || 'Both';
      const allowedModes = getAllowedModes(transportMode);
      
      let bestRbtTravelTime: number | null = null;
      let bestRbtMode: 'driving' | 'transit' = 'driving';
      let bestRbtResult: any = null;

      // Try each allowed mode and pick the best
      for (const mode of allowedModes) {
        const travelResult = await getCachedTravelTime({
          originLat: rbtCoords.lat,
          originLng: rbtCoords.lng,
          destLat: clientCoords.lat,
          destLng: clientCoords.lng,
          mode,
          originId: rbt.id,
          originType: 'rbt',
          destId: client.id,
          destType: 'client',
        });

        if (!travelResult) {
          continue;
        }

        // Track API calls vs cache hits
        if (travelResult.fromCache) {
          cacheHits++;
        } else {
          googleApiCalls += travelResult.samples?.length || 1;
        }

        const durationSec = travelResult.durationSecPessimistic; // Use pessimistic for matching

        // Must be within max travel time
        if (durationSec > MAX_TRAVEL_TIME_SECONDS) {
          continue;
        }

        // Pick the shortest valid duration
        if (bestRbtTravelTime === null || durationSec < bestRbtTravelTime) {
          bestRbtTravelTime = durationSec;
          bestRbtMode = mode;
          bestRbtResult = travelResult;
        }
      }

      // If no valid mode found, skip this RBT
      if (bestRbtTravelTime === null) {
        continue;
      }

      // Calculate distance
      const distanceMiles = bestRbtResult.distanceMeters
        ? Math.round((bestRbtResult.distanceMeters / 1609.34) * 10) / 10
        : calculateDistance(clientCoords, rbtCoords);

      // Compare with current best match
      // Primary: minimum duration
      // Tie-breaker: higher geocode confidence, then shorter distance
      const shouldReplace = bestTravelTime === null || 
        bestRbtTravelTime < bestTravelTime ||
        (bestRbtTravelTime === bestTravelTime && 
         (rbt.geocode_confidence || 0) > (bestRBT?.geocode_confidence || 0)) ||
        (bestRbtTravelTime === bestTravelTime &&
         rbt.geocode_confidence === bestRBT?.geocode_confidence &&
         (distanceMiles !== null && (bestDistance === null || distanceMiles < bestDistance)));

      if (shouldReplace) {
        bestRBT = rbt;
        bestTravelTime = bestRbtTravelTime;
        bestDistance = distanceMiles;
        bestMode = bestRbtMode;
        bestTravelResult = bestRbtResult;
      }
    }

    if (bestRBT && bestTravelTime !== null && bestTravelResult) {
      matchedRBTIds.add(bestRBT.id);
      
      // Build explain object
      const flags: string[] = [];
      if (bestRBT.geocode_confidence && bestRBT.geocode_confidence >= 0.8) {
        flags.push('High location accuracy');
      }
      if (bestTravelTime <= 15 * 60) {
        flags.push('Short commute');
      }
      if (bestRBT.transport_mode === 'Both' && bestMode === 'transit') {
        flags.push('Optimal transit route');
      }
      if (bestRBT.zip && client.zip && bestRBT.zip.substring(0, 3) === client.zip.substring(0, 3)) {
        flags.push('Same ZIP area');
      }

      const match: ClientMatch = {
        client,
        rbt: bestRBT,
        travelTimeSeconds: bestTravelTime,
        travelTimeMinutes: Math.round(bestTravelTime / 60),
        distanceMiles: bestDistance,
        reason: `Matched - ${Math.round(bestTravelTime / 60)} min travel time`,
        status: 'matched',
        travelMode: bestMode,
        source: 'AUTO', // Auto-matched by algorithm
        locked: false,
        explain: {
          chosenMode: bestMode,
          travelTimeMin: Math.round(bestTravelTime / 60),
          distanceMiles: bestDistance,
          bucket: bestTravelResult.bucket,
          samples: bestTravelResult.samples || [],
          flags,
        },
      };
      
      // Validate the match
      const validation = validateMatch(match);
      
      // Default to 'matched' status - only change to 'needs_review' for serious issues
      match.status = 'matched';
      
      // Add warnings if any
      if (validation.warnings.length > 0) {
        match.warnings = validation.warnings;
        if (match.explain) {
          match.explain.flags.push(...validation.warnings.map(w => `⚠️ ${w}`));
        }
      }
      
      // Only mark as needs_review if there are serious validation issues (not just warnings)
      // Missing coordinates alone is NOT a blocker if we calculated travel time successfully
      if (validation.needsReview && validation.reviewReasons.length > 0) {
        // Filter out "missing coordinates" reasons - if we have travel time, coordinates exist
        const seriousReasons = validation.reviewReasons.filter(reason => 
          !reason.toLowerCase().includes('missing coordinates') &&
          !reason.toLowerCase().includes('coordinates missing')
        );
        
        if (seriousReasons.length > 0) {
          // Real issues that need review (distance/time mismatch, precision issues, etc.)
          match.status = 'needs_review';
          match.needsReview = true;
          match.reviewReason = seriousReasons.join('; ');
          match.reason = `Needs Review: ${seriousReasons[0]}`;
          if (match.explain) {
            match.explain.flags.push(`⚠️ ${seriousReasons[0]}`);
          }
          console.log(`   🔍 ${client.name} → ${bestRBT.full_name} (NEEDS REVIEW: ${seriousReasons[0]})`);
        } else {
          // Only coordinate issues (but we have travel time, so coordinates work) - keep as matched
          console.log(`   ✅ ${client.name} → ${bestRBT.full_name} (${Math.round(bestTravelTime / 60)} min ${bestMode})`);
        }
      } else {
        // No serious issues - valid match
        console.log(`   ✅ ${client.name} → ${bestRBT.full_name} (${Math.round(bestTravelTime / 60)} min ${bestMode})`);
      }
      
      matches.push(match);
      autoCount++;
    } else {
      matches.push({
        client,
        rbt: null,
        travelTimeSeconds: null,
        travelTimeMinutes: null,
        distanceMiles: null,
        reason: `No RBT within ${getMatchMaxTravelMinutes()} minutes`,
        status: 'standby',
        source: 'AUTO',
      });
      console.log(`   ⏳ ${client.name} → No match (standby)`);
    }
  }

  // Add clients without location
  for (const client of clientsWithoutLocation) {
    matches.push({
      client,
      rbt: null,
      travelTimeSeconds: null,
      travelTimeMinutes: null,
      distanceMiles: null,
      reason: 'Missing location information - set aside for later',
      status: 'no_location',
      source: 'AUTO',
    });
    console.log(`   ⚠️  ${client.name} → Missing location (set aside)`);
  }

  // Log summary
  const matchedCount = matches.filter(m => m.status === 'matched').length;
  const standbyCount = matches.filter(m => m.status === 'standby').length;
  const noLocationCount = matches.filter(m => m.status === 'no_location').length;
  const needsReviewCount = matches.filter(m => m.needsReview).length;

  console.log(`\n📊 Matching Summary:`);
  console.log(`   ✅ Matched: ${matchedCount}`);
  console.log(`   🔒 Locked: ${lockedCount}`);
  console.log(`   🤖 Auto: ${autoCount}`);
  console.log(`   🚫 Blocked: ${blockedCount}`);
  console.log(`   ⏳ Standby: ${standbyCount}`);
  console.log(`   ⚠️  No Location: ${noLocationCount}`);
  if (needsReviewCount > 0) {
    console.log(`   🔍 Needs Review: ${needsReviewCount}`);
  }
  console.log(`   📞 Google API Calls: ${googleApiCalls}`);
  console.log(`   💾 Cache Hits: ${cacheHits}`);
  if (googleApiCalls + cacheHits > 0) {
    const hitRate = ((cacheHits / (googleApiCalls + cacheHits)) * 100).toFixed(1);
    console.log(`   📈 Cache Hit Rate: ${hitRate}%`);
  }

  return {
    matches,
    googleApiCalls,
    cacheHits,
    blockedCount,
    lockedCount,
    autoCount,
    manualCount, // TODO: Track manual assignments separately if needed
  };
}

/**
 * Calculates distance between two coordinates in miles using Haversine formula
 */
function calculateDistance(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): number {
  const R = 3959; // Earth radius in miles
  const dLat = (destination.lat - origin.lat) * Math.PI / 180;
  const dLon = (destination.lng - origin.lng) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(origin.lat * Math.PI / 180) * Math.cos(destination.lat * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(1));
}
