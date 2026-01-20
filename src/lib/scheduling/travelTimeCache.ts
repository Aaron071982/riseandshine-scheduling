/**
 * Travel Time Cache Service
 * 
 * Caches travel time calculations to reduce Google Maps API calls.
 * Uses time-bucket averaging for peak-hour window (2-8 PM by default).
 * 
 * IMPORTANT: Cache entries include origin_type and dest_type to avoid
 * ambiguity between RBT and client IDs.
 */

import { getSchedulingClient, isSchedulingDBConfigured, isDBValidated } from '../supabaseSched';
import { config, getPeakBucketName, getPeakSampleTimes, getTrafficModel, getTravelTimeTtlDays } from '../config';

// Entity types for cache disambiguation
export type EntityType = 'rbt' | 'client';

export interface TravelTimeResult {
  durationSec: number; // Primary duration (median of samples for matching)
  durationSecAvg: number; // Average duration
  durationSecPessimistic: number; // Pessimistic estimate (max or median * 1.1)
  distanceMeters: number | null;
  mode: 'driving' | 'transit';
  bucket: string;
  fromCache: boolean;
  computedAt: string;
  samples: Array<{
    departureLocal: string; // ISO string of departure time
    durationMin: number;
    distanceMiles: number | null;
    source: 'cache' | 'google';
  }>;
}

export interface CacheEntry {
  id: string;
  originId: string | null;
  originType: EntityType;
  destId: string | null;
  destType: EntityType;
  originHash: string;
  destHash: string;
  mode: string;
  bucket: string;
  durationSecAvg: number;
  durationSecPessimistic: number;
  distanceMeters: number | null;
  computedAt: string;
  expiresAt: string;
  sampleTimes?: string[];
  sampleDurations?: number[];
}

export interface CacheLookupParams {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  mode: 'driving' | 'transit';
  originId?: string;
  originType: EntityType;
  destId?: string;
  destType: EntityType;
}

/**
 * Generates a location hash for cache lookups
 * Rounds to 3 decimal places (~100m precision)
 */
export function generateLocationHash(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

// Concurrency control for Google API calls
const MAX_CONCURRENT_REQUESTS = 5;
let inFlightRequests = 0;
const requestQueue: Array<() => Promise<void>> = [];

/**
 * Execute Google API request with concurrency control
 */
async function executeWithConcurrencyControl<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const execute = async () => {
      if (inFlightRequests >= MAX_CONCURRENT_REQUESTS) {
        requestQueue.push(execute);
        return;
      }

      inFlightRequests++;
      try {
        const result = await fn();
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        inFlightRequests--;
        if (requestQueue.length > 0) {
          const next = requestQueue.shift();
          if (next) next();
        }
      }
    };
    execute();
  });
}

/**
 * Calls Google Distance Matrix API with departure time and traffic model
 */
async function callGoogleDistanceMatrix(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  mode: 'driving' | 'transit',
  departureTime: Date,
  trafficModel?: 'best_guess' | 'pessimistic' | 'optimistic'
): Promise<{ durationSec: number; distanceMeters: number | null } | null> {
  const apiKey = config.googleMapsApiKey;
  
  if (!apiKey) {
    console.warn('Google Maps API key not found, using fallback estimation');
    return estimateTravelTimeFallback(originLat, originLng, destLat, destLng, mode);
  }

  const params = new URLSearchParams({
    origins: `${originLat},${originLng}`,
    destinations: `${destLat},${destLng}`,
    key: apiKey,
    mode: mode,
    departure_time: Math.floor(departureTime.getTime() / 1000).toString(), // Unix timestamp
  });

  // For driving mode, add traffic_model parameter
  if (mode === 'driving' && trafficModel) {
    params.append('traffic_model', trafficModel);
  }

  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`
    );

    if (!response.ok) {
      console.warn(`Distance Matrix API error: ${response.status}`);
      return estimateTravelTimeFallback(originLat, originLng, destLat, destLng, mode);
    }

    const data = await response.json() as any;

    if (data.status === 'OK' && data.rows && data.rows.length > 0) {
      const element = data.rows[0].elements?.[0];
      if (element && element.status === 'OK') {
        // For driving, prefer duration_in_traffic if available
        const duration = mode === 'driving' && element.duration_in_traffic
          ? element.duration_in_traffic.value
          : element.duration?.value;

        if (duration) {
          return {
            durationSec: duration,
            distanceMeters: element.distance?.value || null,
          };
        }
      }
    }

    return estimateTravelTimeFallback(originLat, originLng, destLat, destLng, mode);
  } catch (error) {
    console.error('Error calling Google Distance Matrix API:', error);
    return estimateTravelTimeFallback(originLat, originLng, destLat, destLng, mode);
  }
}

/**
 * Fallback travel time estimation based on distance
 */
function estimateTravelTimeFallback(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  mode: 'driving' | 'transit'
): { durationSec: number; distanceMeters: number } {
  // Calculate distance using Haversine formula
  const R = 6371e3; // Earth radius in meters
  const φ1 = originLat * Math.PI / 180;
  const φ2 = destLat * Math.PI / 180;
  const Δφ = (destLat - originLat) * Math.PI / 180;
  const Δλ = (destLng - originLng) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distanceMeters = R * c;

  // Estimate time based on mode
  let durationSec: number;
  if (mode === 'transit') {
    durationSec = Math.round((distanceMeters / 1609.34) * 3.5 * 60); // ~3.5 min per mile
  } else {
    durationSec = Math.round((distanceMeters / 1609.34) * 2.2 * 60); // ~2.2 min per mile (city traffic)
  }

  return { durationSec, distanceMeters };
}

/**
 * Gets the next weekday sample times based on config
 */
function getNextWeekdaySampleTimes(): Date[] {
  const now = new Date();
  let nextWeekday = new Date(now);
  
  // Find next weekday
  const dayOfWeek = nextWeekday.getDay();
  if (dayOfWeek === 0) {
    nextWeekday.setDate(nextWeekday.getDate() + 1); // Sunday -> Monday
  } else if (dayOfWeek === 6) {
    nextWeekday.setDate(nextWeekday.getDate() + 2); // Saturday -> Monday
  } else {
    // If it's already a weekday, use today if time hasn't passed, otherwise next weekday
    const todayHour = now.getHours();
    const latestSampleHour = Math.max(...getPeakSampleTimes().map(t => parseInt(t.split(':')[0])));
    if (todayHour >= latestSampleHour) {
      // All sample times have passed, use next weekday
      nextWeekday.setDate(nextWeekday.getDate() + 1);
      const nextDayOfWeek = nextWeekday.getDay();
      if (nextDayOfWeek === 0) nextWeekday.setDate(nextWeekday.getDate() + 1);
      if (nextDayOfWeek === 6) nextWeekday.setDate(nextWeekday.getDate() + 2);
    }
  }

  // Create sample times from config (default: 14:30, 16:30, 18:30)
  const sampleTimeStrings = getPeakSampleTimes();
  const times: Date[] = [];
  
  for (const timeStr of sampleTimeStrings) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const t = new Date(nextWeekday);
    t.setHours(hours, minutes || 0, 0, 0);
    times.push(t);
  }

  return times;
}

/**
 * Computes median of numbers
 */
function median(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Computes travel time using Google Maps Distance Matrix API
 * Averages across multiple sample departure times in the peak window
 */
async function computeTravelTime(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  mode: 'driving' | 'transit'
): Promise<TravelTimeResult | null> {
  const sampleTimes = getNextWeekdaySampleTimes();
  const trafficModel = getTrafficModel();
  const bucket = getPeakBucketName();

  const sampleResults: Array<{
    departureLocal: Date;
    durationSec: number;
    distanceMeters: number | null;
  }> = [];

  // Call API for each sample time with concurrency control
  const promises = sampleTimes.map(async (departureTime) => {
    return executeWithConcurrencyControl(async () => {
      const result = await callGoogleDistanceMatrix(
        originLat,
        originLng,
        destLat,
        destLng,
        mode,
        departureTime,
        mode === 'driving' ? trafficModel : undefined
      );
      
      if (result) {
        sampleResults.push({
          departureLocal: departureTime,
          durationSec: result.durationSec,
          distanceMeters: result.distanceMeters,
        });
      }
    });
  });

  // Wait for all requests to complete (or fail)
  await Promise.allSettled(promises);

  // If all requests failed, return null
  if (sampleResults.length === 0) {
    console.warn(`   All Google API calls failed for ${originLat},${originLng} -> ${destLat},${destLng}`);
    return null;
  }

  // Calculate statistics from samples
  const durations = sampleResults.map(r => r.durationSec);
  const medianDuration = median(durations);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
  const maxDuration = Math.max(...durations);
  
  // Pessimistic estimate: max of samples or median * 1.1, whichever is higher
  const pessimisticDuration = Math.max(maxDuration, Math.round(medianDuration * 1.1));

  // Use median distance (or average if all are similar)
  const distances = sampleResults.map(r => r.distanceMeters).filter((d): d is number => d !== null);
  const avgDistance = distances.length > 0 
    ? Math.round(distances.reduce((a, b) => a + b, 0) / distances.length)
    : null;

  // Build samples array for result
  const samples = sampleResults.map(r => ({
    departureLocal: r.departureLocal.toISOString(),
    durationMin: Math.round(r.durationSec / 60),
    distanceMiles: r.distanceMeters ? Math.round((r.distanceMeters / 1609.34) * 10) / 10 : null,
    source: 'google' as const,
  }));

  return {
    durationSec: Math.round(medianDuration), // Primary duration for matching
    durationSecAvg: Math.round(avgDuration),
    durationSecPessimistic: pessimisticDuration,
    distanceMeters: avgDistance,
    mode,
    bucket,
    fromCache: false,
    computedAt: new Date().toISOString(),
    samples,
  };
}

/**
 * Looks up travel time in cache (with backward compatibility for weekday_3to8)
 */
async function lookupCache(
  originHash: string,
  destHash: string,
  mode: string,
  originType: EntityType,
  destType: EntityType
): Promise<CacheEntry | null> {
  try {
    const supabase = getSchedulingClient();
    const currentBucket = getPeakBucketName();
    
    // Try current bucket first, then fallback to weekday_3to8
    const bucketsToTry = currentBucket === 'weekday_2to8' 
      ? ['weekday_2to8', 'weekday_3to8']
      : [currentBucket];

    for (const bucket of bucketsToTry) {
      const { data, error } = await supabase
        .from('travel_time_cache')
        .select('*')
        .eq('origin_hash', originHash)
        .eq('dest_hash', destHash)
        .eq('origin_type', originType)
        .eq('dest_type', destType)
        .eq('mode', mode)
        .eq('time_bucket', bucket)
        .single();
      
      if (!error && data) {
        // Check if expired
        if (data.expires_at) {
          const expiresAt = new Date(data.expires_at);
          if (expiresAt < new Date()) {
            continue; // Try next bucket
          }
        }

        return {
          id: data.id,
          originId: data.origin_id,
          originType: data.origin_type,
          destId: data.dest_id,
          destType: data.dest_type,
          originHash: data.origin_hash,
          destHash: data.dest_hash,
          mode: data.mode,
          bucket: data.time_bucket,
          durationSecAvg: data.duration_sec_avg,
          durationSecPessimistic: data.duration_sec_pessimistic || data.duration_sec_avg,
          distanceMeters: data.distance_meters,
          computedAt: data.computed_at,
          expiresAt: data.expires_at,
          sampleTimes: data.sample_times,
          sampleDurations: data.sample_durations,
        };
      }
    }

    return null;
  } catch (error) {
    console.warn('Cache lookup error:', error);
    return null;
  }
}

interface StoreParams {
  originHash: string;
  destHash: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  mode: string;
  originId: string | null;
  originType: EntityType;
  destId: string | null;
  destType: EntityType;
  result: TravelTimeResult;
}

/**
 * Stores travel time result in cache
 */
async function storeInCache(params: StoreParams): Promise<void> {
  const { originHash, destHash, originLat, originLng, destLat, destLng, mode, originId, originType, destId, destType, result } = params;
  
  try {
    const supabase = getSchedulingClient();
    const ttlDays = getTravelTimeTtlDays();
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);
    
    await supabase
      .from('travel_time_cache')
      .upsert({
        origin_hash: originHash,
        dest_hash: destHash,
        origin_id: originId,
        origin_type: originType,
        dest_id: destId,
        dest_type: destType,
        origin_lat: originLat,
        origin_lng: originLng,
        dest_lat: destLat,
        dest_lng: destLng,
        mode,
        time_bucket: result.bucket,
        traffic_model: getTrafficModel(),
        duration_sec_avg: result.durationSecAvg,
        duration_sec_pessimistic: result.durationSecPessimistic,
        distance_meters: result.distanceMeters,
        sample_times: result.samples.map(s => s.departureLocal),
        sample_durations: result.samples.map(s => s.durationMin * 60),
        computed_at: result.computedAt,
        expires_at: expiresAt.toISOString(),
      }, {
        onConflict: 'origin_hash,dest_hash,origin_type,dest_type,mode,time_bucket',
      });
  } catch (error) {
    console.warn('Cache store error:', error);
  }
}

/**
 * Gets travel time, using cache if available
 * 
 * @param params - Cache lookup parameters including lat/lng directly
 */
export async function getCachedTravelTime(params: CacheLookupParams): Promise<TravelTimeResult | null> {
  const { originLat, originLng, destLat, destLng, mode, originId, originType, destId, destType } = params;
  
  const originHash = generateLocationHash(originLat, originLng);
  const destHash = generateLocationHash(destLat, destLng);
  
  // Try cache first (only if DB is validated)
  if (isSchedulingDBConfigured() && isDBValidated()) {
    const cached = await lookupCache(originHash, destHash, mode, originType, destType);
    if (cached) {
      // Reconstruct samples from cached data if available
      const samples = cached.sampleTimes && cached.sampleDurations
        ? cached.sampleTimes.map((time, i) => ({
            departureLocal: time,
            durationMin: Math.round((cached.sampleDurations?.[i] || cached.durationSecAvg) / 60),
            distanceMiles: cached.distanceMeters ? Math.round((cached.distanceMeters / 1609.34) * 10) / 10 : null,
            source: 'cache' as const,
          }))
        : [];

      return {
        durationSec: cached.durationSecPessimistic, // Use pessimistic for matching
        durationSecAvg: cached.durationSecAvg,
        durationSecPessimistic: cached.durationSecPessimistic,
        distanceMeters: cached.distanceMeters,
        mode: mode as 'driving' | 'transit',
        bucket: cached.bucket,
        fromCache: true,
        computedAt: cached.computedAt,
        samples: samples.length > 0 ? samples : [{
          departureLocal: cached.computedAt,
          durationMin: Math.round(cached.durationSecPessimistic / 60),
          distanceMiles: cached.distanceMeters ? Math.round((cached.distanceMeters / 1609.34) * 10) / 10 : null,
          source: 'cache' as const,
        }],
      };
    }
  }
  
  // Compute fresh travel time
  const result = await computeTravelTime(originLat, originLng, destLat, destLng, mode);
  
  if (result && isSchedulingDBConfigured() && isDBValidated()) {
    // Store in cache with entity types
    await storeInCache({
      originHash,
      destHash,
      originLat,
      originLng,
      destLat,
      destLng,
      mode,
      originId: originId || null,
      originType,
      destId: destId || null,
      destType,
      result,
    });
  }
  
  return result;
}

/**
 * Clears expired cache entries
 */
export async function clearExpiredCache(): Promise<number> {
  if (!isSchedulingDBConfigured() || !isDBValidated()) {
    return 0;
  }
  
  try {
    const supabase = getSchedulingClient();
    
    const { data, error } = await supabase
      .from('travel_time_cache')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select('id');
    
    if (error) {
      console.error('Error clearing cache:', error);
      return 0;
    }
    
    return data?.length || 0;
  } catch (error) {
    console.error('Failed to clear cache:', error);
    return 0;
  }
}

/**
 * Gets cache statistics
 */
export async function getCacheStats(): Promise<{
  totalEntries: number;
  expiredEntries: number;
  avgAge: number;
}> {
  if (!isSchedulingDBConfigured() || !isDBValidated()) {
    return { totalEntries: 0, expiredEntries: 0, avgAge: 0 };
  }
  
  try {
    const supabase = getSchedulingClient();
    
    const { data: total, error: totalError } = await supabase
      .from('travel_time_cache')
      .select('id', { count: 'exact', head: true });
    
    const { data: expired, error: expiredError } = await supabase
      .from('travel_time_cache')
      .select('id', { count: 'exact', head: true })
      .lt('expires_at', new Date().toISOString());
    
    if (totalError || expiredError) {
      console.error('Error getting cache stats:', totalError || expiredError);
      return { totalEntries: 0, expiredEntries: 0, avgAge: 0 };
    }
    
    return {
      totalEntries: total?.length || 0,
      expiredEntries: expired?.length || 0,
      avgAge: 0, // Would need to calculate from computed_at
    };
  } catch (error) {
    console.error('Failed to get cache stats:', error);
    return { totalEntries: 0, expiredEntries: 0, avgAge: 0 };
  }
}

/**
 * Invalidates cache entries for a specific entity
 * Call this when coordinates are updated
 */
export async function invalidateCacheForEntity(
  entityType: EntityType,
  entityId: string
): Promise<void> {
  if (!isSchedulingDBConfigured() || !isDBValidated()) {
    return;
  }
  
  try {
    const supabase = getSchedulingClient();
    
    // Delete entries where this entity is origin or destination
    await supabase
      .from('travel_time_cache')
      .delete()
      .or(`and(origin_id.eq.${entityId},origin_type.eq.${entityType}),and(dest_id.eq.${entityId},dest_type.eq.${entityType})`);
      
    console.log(`   Invalidated cache for ${entityType} ${entityId}`);
  } catch (error) {
    console.warn('Failed to invalidate cache:', error);
  }
}

/**
 * Invalidates cache entries for a specific location hash
 * Call this when coordinates are updated but entity ID is unknown
 */
export async function invalidateCacheForLocation(lat: number, lng: number): Promise<void> {
  if (!isSchedulingDBConfigured() || !isDBValidated()) {
    return;
  }
  
  const hash = generateLocationHash(lat, lng);
  
  try {
    const supabase = getSchedulingClient();
    
    await supabase
      .from('travel_time_cache')
      .delete()
      .or(`origin_hash.eq.${hash},dest_hash.eq.${hash}`);
  } catch (error) {
    console.warn('Failed to invalidate cache:', error);
  }
}
