/**
 * Match Suggestion Algorithm
 * 
 * Generates potential RBT-Client matches based on:
 * - Travel time (3-8 PM static estimates)
 * - Zip code proximity
 * - Geocoding quality
 * - Availability overlap (if available)
 * 
 * Results are stored in match_suggestions table for admin approval.
 */

import { getSchedulingClient, isDBValidated } from '../supabaseSched';
import { getCachedTravelTime } from './travelTimeCache';
import { validateMatch } from './validation';
import type { Client } from '../clients';
import type { RBT } from '../rbts';
import { getPeakBucketName } from '../config';

export interface MatchSuggestion {
  rbtId: string;
  clientId: string;
  score: number;
  rationale: {
    travelTimeSec: number | null;
    travelTimeMinutes: number | null;
    distanceMeters: number | null;
    distanceMiles: number | null;
    zipMatch: boolean;
    zipProximity: number; // 0-1, how close the zips are
    geocodeQuality: {
      client: 'Good' | 'Medium' | 'Bad';
      rbt: 'Good' | 'Medium' | 'Bad';
    };
    needsReview: boolean;
    reviewReasons: string[];
    flags: string[];
  };
  travelMode: 'driving' | 'transit';
  needsReview: boolean;
  reviewReason: string | null;
}

/**
 * Calculates match score (0-100)
 * Higher score = better match
 */
function calculateScore(
  travelTimeMinutes: number | null,
  distanceMiles: number | null,
  zipMatch: boolean,
  zipProximity: number,
  clientGeocodeQuality: 'Good' | 'Medium' | 'Bad',
  rbtGeocodeQuality: 'Good' | 'Medium' | 'Bad',
  needsReview: boolean
): number {
  let score = 100;
  
  // Penalize travel time (max 30 min = 24 point penalty)
  if (travelTimeMinutes !== null) {
    const timePenalty = Math.min(travelTimeMinutes * 0.8, 30);
    score -= timePenalty;
  } else {
    score -= 25; // Unknown travel time is bad
  }
  
  // Bonus for zip match
  if (zipMatch) {
    score += 10;
  } else if (zipProximity > 0.5) {
    score += 5 * zipProximity; // Partial zip match
  }
  
  // Penalize bad geocoding quality
  if (clientGeocodeQuality === 'Bad' || rbtGeocodeQuality === 'Bad') {
    score -= 15;
  } else if (clientGeocodeQuality === 'Medium' || rbtGeocodeQuality === 'Medium') {
    score -= 5;
  }
  
  // Heavy penalty if needs review
  if (needsReview) {
    score -= 20;
  }
  
  // Ensure score is between 0 and 100
  return Math.max(0, Math.min(100, Math.round(score * 100) / 100));
}

/**
 * Gets geocode quality string
 */
function getGeocodeQuality(precision: string | null | undefined): 'Good' | 'Medium' | 'Bad' {
  if (!precision) return 'Bad';
  
  switch (precision) {
    case 'ROOFTOP':
    case 'RANGE_INTERPOLATED':
      return 'Good';
    case 'GEOMETRIC_CENTER':
      return 'Medium';
    case 'APPROXIMATE':
    case 'UNKNOWN':
    default:
      return 'Bad';
  }
}

/**
 * Calculates zip code proximity (0-1)
 * Returns 1.0 if exact match, 0.5 if first 3 digits match, 0.0 otherwise
 */
function calculateZipProximity(zip1: string | null, zip2: string | null): number {
  if (!zip1 || !zip2) return 0;
  
  // Exact match
  if (zip1 === zip2) return 1.0;
  
  // First 3 digits match (same area)
  if (zip1.substring(0, 3) === zip2.substring(0, 3)) return 0.5;
  
  return 0;
}

/**
 * Converts meters to miles
 */
function metersToMiles(meters: number | null): number | null {
  if (meters === null) return null;
  return Math.round((meters / 1609.34) * 10) / 10; // Round to 1 decimal
}

/**
 * Generates match suggestions for all RBT-Client pairs
 */
export async function suggestMatches(
  maxSuggestionsPerRBT: number = 10
): Promise<{ total: number; suggestions: MatchSuggestion[] }> {
  if (!isDBValidated()) {
    throw new Error('Database not validated. Cannot generate suggestions.');
  }
  
  const supabase = getSchedulingClient();
  
  console.log('🔍 Generating match suggestions...\n');
  
  // Fetch all RBTs with location data
  const { data: rbts, error: rbtError } = await supabase
    .from('rbt_profiles')
    .select('*')
    .eq('is_active', true)
    .not('lat', 'is', null)
    .not('lng', 'is', null);
  
  if (rbtError) {
    throw new Error(`Failed to fetch RBTs: ${rbtError.message}`);
  }
  
  if (!rbts || rbts.length === 0) {
    console.warn('⚠️ No RBTs with location data found');
    return { total: 0, suggestions: [] };
  }
  
  console.log(`   Found ${rbts.length} RBTs with location data`);
  
  // Fetch all clients with location data
  const { data: clients, error: clientError } = await supabase
    .from('clients')
    .select('*')
    .not('lat', 'is', null)
    .not('lng', 'is', null);
  
  if (clientError) {
    throw new Error(`Failed to fetch clients: ${clientError.message}`);
  }
  
  if (!clients || clients.length === 0) {
    console.warn('⚠️ No clients with location data found');
    return { total: 0, suggestions: [] };
  }
  
  console.log(`   Found ${clients.length} clients with location data\n`);
  
  const allSuggestions: MatchSuggestion[] = [];
  
  // For each RBT, find best client matches
  for (const rbt of rbts) {
    if (!rbt.lat || !rbt.lng) continue;
    
    const rbtSuggestions: MatchSuggestion[] = [];
    
    for (const client of clients) {
      if (!client.lat || !client.lng) continue;
      
      // Determine travel mode based on RBT transport preference
      const transportMode = rbt.transport_mode || 'Both';
      const modesToTry: ('driving' | 'transit')[] = 
        transportMode === 'Both' ? ['driving', 'transit'] :
        transportMode === 'Car' ? ['driving'] :
        transportMode === 'Transit' ? ['transit'] : ['driving'];
      
      let bestTravelTime: number | null = null;
      let bestDistance: number | null = null;
      let bestMode: 'driving' | 'transit' = 'driving';
      let bestTravelResult: any = null;
      
      // Try each mode and pick the best
      for (const mode of modesToTry) {
        const travelResult = await getCachedTravelTime({
          originLat: rbt.lat!,
          originLng: rbt.lng!,
          destLat: client.lat!,
          destLng: client.lng!,
          mode,
          originId: rbt.id,
          originType: 'rbt',
          destId: client.id,
          destType: 'client',
        });
        
        if (travelResult) {
          const timeMinutes = Math.round(travelResult.durationSecPessimistic / 60);
          
          // Prefer shorter travel time
          if (bestTravelTime === null || timeMinutes < bestTravelTime) {
            bestTravelTime = timeMinutes;
            bestDistance = travelResult.distanceMeters;
            bestMode = mode;
            bestTravelResult = travelResult;
          }
        }
      }
      
      // Skip if travel time is too long (> 60 minutes)
      if (bestTravelTime === null || bestTravelTime > 60) {
        continue;
      }
      
      // Calculate zip proximity (using DB column names directly)
      const rbtZip = rbt.zip_code || null;
      const clientZip = client.zip || null;
      const zipMatch = rbtZip === clientZip && rbtZip !== null;
      const zipProximity = calculateZipProximity(rbtZip, clientZip);
      
      // Get geocode quality
      const clientQuality = getGeocodeQuality(client.geocode_precision);
      const rbtQuality = getGeocodeQuality(rbt.geocode_precision);
      
      // Check if suspicious (using validation logic)
      const mockMatch = {
        client: { ...client, geocode_precision: client.geocode_precision },
        rbt: { ...rbt, geocode_precision: rbt.geocode_precision },
        travelTimeMinutes: bestTravelTime,
        travelTimeSeconds: bestTravelTime ? bestTravelTime * 60 : null,
        distanceMiles: metersToMiles(bestDistance),
        locationBorough: client.location_borough,
        status: 'matched',
      } as any;
      
      const validation = validateMatch(mockMatch);
      const needsReview = validation.needsReview;
      
      // Calculate score
      const score = calculateScore(
        bestTravelTime,
        metersToMiles(bestDistance),
        zipMatch,
        zipProximity,
        clientQuality,
        rbtQuality,
        needsReview
      );
      
      // Build rationale
      const flags: string[] = [];
      if (zipMatch) flags.push('Same ZIP code');
      if (zipProximity > 0 && !zipMatch) flags.push('Nearby ZIP code');
      if (clientQuality === 'Good' && rbtQuality === 'Good') flags.push('High location accuracy');
      if (bestTravelTime && bestTravelTime <= 15) flags.push('Short commute');
      if (bestTravelResult?.bucket) {
        flags.push(`Bucket: ${bestTravelResult.bucket}`);
      }
      if (transportMode === 'Both' && bestMode === 'transit') {
        flags.push('Optimal transit route selected');
      }
      
      const suggestion: MatchSuggestion = {
        rbtId: rbt.id,
        clientId: client.id,
        score,
        rationale: {
          travelTimeSec: bestTravelTime ? bestTravelTime * 60 : null,
          travelTimeMinutes: bestTravelTime,
          distanceMeters: bestDistance,
          distanceMiles: metersToMiles(bestDistance),
          zipMatch,
          zipProximity,
          geocodeQuality: {
            client: clientQuality,
            rbt: rbtQuality,
          },
          needsReview,
          reviewReasons: validation.reviewReasons || [],
          flags,
        },
        travelMode: bestMode,
        needsReview,
        reviewReason: validation.reviewReasons?.join('; ') || null,
      };
      
      rbtSuggestions.push(suggestion);
    }
    
    // Sort by score (highest first) and take top N
    rbtSuggestions.sort((a, b) => b.score - a.score);
    const topSuggestions = rbtSuggestions.slice(0, maxSuggestionsPerRBT);
    
    allSuggestions.push(...topSuggestions);
    
    const rbtName = rbt.full_name || `${rbt.first_name || ''} ${rbt.last_name || ''}`.trim() || 'Unknown RBT';
    console.log(`   ${rbtName}: ${topSuggestions.length} suggestions (top score: ${topSuggestions[0]?.score || 0})`);
  }
  
  console.log(`\n✅ Generated ${allSuggestions.length} total suggestions\n`);
  
  // Upsert suggestions into database
  // Only update PENDING suggestions, preserve APPROVED/REJECTED
  for (const suggestion of allSuggestions) {
    // Check if suggestion already exists
    const { data: existing } = await supabase
      .from('match_suggestions')
      .select('status')
      .eq('rbt_id', suggestion.rbtId)
      .eq('client_id', suggestion.clientId)
      .single();
    
    // Skip if already approved or rejected
    if (existing && (existing.status === 'APPROVED' || existing.status === 'REJECTED')) {
      continue;
    }
    
    // Upsert the suggestion
    const { error } = await supabase
      .from('match_suggestions')
      .upsert({
        rbt_id: suggestion.rbtId,
        client_id: suggestion.clientId,
        status: existing?.status || 'PENDING', // Preserve existing status
        score: suggestion.score,
        rationale: suggestion.rationale,
        travel_time_sec: suggestion.rationale.travelTimeSec,
        distance_meters: suggestion.rationale.distanceMeters,
        travel_mode: suggestion.travelMode,
        client_geocode_precision: suggestion.rationale.geocodeQuality.client,
        rbt_geocode_precision: suggestion.rationale.geocodeQuality.rbt,
        needs_review: suggestion.needsReview,
        review_reason: suggestion.reviewReason,
        computed_at: new Date().toISOString(),
      }, {
        onConflict: 'rbt_id,client_id',
      });
    
    if (error) {
      console.error(`Error upserting suggestion for RBT ${suggestion.rbtId} - Client ${suggestion.clientId}:`, error);
    }
  }
  
  console.log(`💾 Saved ${allSuggestions.length} suggestions to database\n`);
  
  return {
    total: allSuggestions.length,
    suggestions: allSuggestions,
  };
}

