/**
 * Geocoding Service with Precision Tracking
 * 
 * Handles geocoding addresses using Google Maps Geocoding API.
 * Tracks precision, confidence, and source for quality assessment.
 */

// Load dotenv only if GOOGLE_MAPS_API_KEY not already set
if (!process.env.GOOGLE_MAPS_API_KEY) {
  try {
    const dotenv = require('dotenv');
    dotenv.config();
  } catch (e) {
    // dotenv not available or already loaded - that's fine
  }
}

import { normalizeAddress, NormalizedAddress, getAddressQualityScore } from './normalize';

const API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

// Geocoding precision types (from Google)
export type GeocodePrecision = 'ROOFTOP' | 'RANGE_INTERPOLATED' | 'GEOMETRIC_CENTER' | 'APPROXIMATE';
export type GeocodeSource = 'full_address' | 'zip_only' | 'city_state' | 'manual_pin' | 'hrm_import' | 'csv_import' | 'crm_import';

export interface GeocodeResult {
  lat: number;
  lng: number;
  precision: GeocodePrecision;
  confidence: number;
  source: GeocodeSource;
  addressUsed: string;
  formattedAddress: string;
  placeId?: string;
  // Quality flags
  needsVerification: boolean;
  warning?: string;
}

export interface GeocodeError {
  error: true;
  message: string;
  code?: string;
  retryable: boolean;
}

// Rate limiting state
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 100; // ms between requests
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;

/**
 * Geocodes an address with precision tracking
 */
export async function geocodeWithPrecision(
  address: string | NormalizedAddress
): Promise<GeocodeResult | GeocodeError> {
  // Normalize if string
  const normalized = typeof address === 'string' ? normalizeAddress(address) : address;
  
  if (!normalized.geocodeString) {
    return {
      error: true,
      message: 'No valid address to geocode',
      retryable: false,
    };
  }
  
  if (!API_KEY) {
    console.warn('⚠️ Google Maps API key not configured - using fallback geocoding');
    return geocodeFallback(normalized);
  }
  
  // Rate limiting
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await sleep(MIN_REQUEST_INTERVAL - timeSinceLastRequest);
  }
  lastRequestTime = Date.now();
  
  try {
    const result = await geocodeWithGoogle(normalized);
    consecutiveErrors = 0; // Reset on success
    return result;
  } catch (error) {
    consecutiveErrors++;
    
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      console.error(`❌ ${MAX_CONSECUTIVE_ERRORS} consecutive geocoding errors - stopping`);
      return {
        error: true,
        message: 'Too many consecutive errors',
        retryable: false,
      };
    }
    
    // Check if retryable
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isRetryable = errorMessage.includes('OVER_QUERY_LIMIT') || 
                        errorMessage.includes('UNKNOWN_ERROR') ||
                        errorMessage.includes('timeout');
    
    return {
      error: true,
      message: errorMessage,
      retryable: isRetryable,
    };
  }
}

/**
 * Geocodes using Google Maps Geocoding API
 */
async function geocodeWithGoogle(normalized: NormalizedAddress): Promise<GeocodeResult | GeocodeError> {
  const params = new URLSearchParams({
    address: normalized.geocodeString,
    key: API_KEY,
  });
  
  // Add component restrictions for better accuracy
  if (normalized.geocodeMethod === 'zip_only' && normalized.zip) {
    // For ZIP-only, restrict to US
    params.set('components', `postal_code:${normalized.zip}|country:US`);
  } else if (normalized.zip && normalized.city && normalized.state) {
    // For addresses with ZIP + city/borough + state, use components for better accuracy
    // This helps with NYC boroughs like "Brooklyn, NY 11214"
    const components = [`postal_code:${normalized.zip}`, `administrative_area:${normalized.state}`, 'country:US'];
    // If city looks like a NYC borough, add it as a locality
    const nycBoroughs = ['brooklyn', 'queens', 'manhattan', 'bronx', 'staten island'];
    if (nycBoroughs.includes(normalized.city.toLowerCase())) {
      components.push(`locality:${normalized.city}`);
    }
    params.set('components', components.join('|'));
  }
  
  const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  const data = await response.json() as any;
  
  // Handle API errors
  if (data.status === 'OVER_QUERY_LIMIT') {
    throw new Error('OVER_QUERY_LIMIT: API quota exceeded');
  }
  
  if (data.status === 'REQUEST_DENIED') {
    throw new Error(`REQUEST_DENIED: ${data.error_message || 'Check API key'}`);
  }
  
  if (data.status === 'ZERO_RESULTS' || !data.results || data.results.length === 0) {
    return {
      error: true,
      message: 'No results found for address',
      retryable: false,
    };
  }
  
  if (data.status !== 'OK') {
    throw new Error(`Geocoding failed: ${data.status}`);
  }
  
  // Get the best result
  const result = data.results[0];
  const location = result.geometry.location;
  const locationType = result.geometry.location_type as GeocodePrecision;
  
  // Calculate confidence based on precision and address quality
  const confidence = calculateConfidence(locationType, normalized);
  
  // Determine if verification is needed
  const needsVerification = 
    locationType === 'APPROXIMATE' ||
    confidence < 0.5 ||
    normalized.geocodeMethod !== 'full_address';
  
  // Generate warning if applicable
  let warning: string | undefined;
  if (locationType === 'APPROXIMATE') {
    warning = 'Location is approximate - verify on map';
  } else if (normalized.geocodeMethod === 'zip_only') {
    warning = 'Geocoded from ZIP code only - street address missing';
  } else if (normalized.geocodeMethod === 'city_state') {
    warning = 'Geocoded from city/state only - address incomplete';
  }
  
  return {
    lat: location.lat,
    lng: location.lng,
    precision: locationType,
    confidence,
    source: normalized.geocodeMethod,
    addressUsed: normalized.geocodeString,
    formattedAddress: result.formatted_address,
    placeId: result.place_id,
    needsVerification,
    warning,
  };
}

/**
 * Fallback geocoding when Google API is unavailable
 * 
 * This is a last-resort fallback that returns an error.
 * In production, always configure GOOGLE_MAPS_API_KEY.
 * 
 * NOTE: No hardcoded city-specific coordinates - that approach
 * doesn't scale and can give wildly wrong results.
 */
function geocodeFallback(normalized: NormalizedAddress): GeocodeResult | GeocodeError {
  // Without an API key, we cannot reliably geocode addresses.
  // Return an error that clearly indicates the issue.
  
  // If we have at least a state, we could potentially return state centroid
  // but that's so imprecise it's essentially useless for scheduling.
  // Better to fail clearly than give bad data.
  
  const hasMinimalData = normalized.hasZip || (normalized.hasCity && normalized.hasState);
  
  if (!hasMinimalData) {
    return {
      error: true,
      message: 'Address is too incomplete to geocode. Need at least ZIP code or city/state.',
      retryable: false,
    };
  }
  
  // We have enough data to geocode, but no API key
  return {
    error: true,
    message: 'GOOGLE_MAPS_API_KEY not configured. Cannot geocode without API access.',
    code: 'NO_API_KEY',
    retryable: false,
  };
}

/**
 * Calculates confidence score based on precision and address quality
 */
function calculateConfidence(precision: GeocodePrecision, normalized: NormalizedAddress): number {
  // Base confidence from precision
  const precisionScores: Record<GeocodePrecision, number> = {
    'ROOFTOP': 1.0,
    'RANGE_INTERPOLATED': 0.8,
    'GEOMETRIC_CENTER': 0.6,
    'APPROXIMATE': 0.3,
  };
  
  let confidence = precisionScores[precision] || 0.5;
  
  // Adjust based on address quality
  const addressQuality = getAddressQualityScore(normalized);
  
  // If address is incomplete but we got ROOFTOP, trust it less
  if (precision === 'ROOFTOP' && addressQuality < 0.5) {
    confidence *= 0.8;
  }
  
  // If we only had ZIP and got GEOMETRIC_CENTER, that's expected
  if (normalized.geocodeMethod === 'zip_only' && precision === 'GEOMETRIC_CENTER') {
    confidence = 0.6; // Standard ZIP centroid confidence
  }
  
  return Math.round(confidence * 100) / 100;
}

/**
 * Batch geocodes multiple addresses with rate limiting
 */
export async function batchGeocode(
  addresses: string[],
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, GeocodeResult | GeocodeError>> {
  const results = new Map<string, GeocodeResult | GeocodeError>();
  
  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];
    const result = await geocodeWithPrecision(address);
    results.set(address, result);
    
    if (onProgress) {
      onProgress(i + 1, addresses.length);
    }
    
    // Check for non-retryable errors
    if ('error' in result && !result.retryable) {
      // Continue with other addresses
    }
    
    // Rate limiting is handled in geocodeWithPrecision
  }
  
  return results;
}

/**
 * Retries a geocode operation with exponential backoff
 */
export async function geocodeWithRetry(
  address: string,
  maxRetries: number = 3
): Promise<GeocodeResult | GeocodeError> {
  let lastError: GeocodeError | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await geocodeWithPrecision(address);
    
    if (!('error' in result)) {
      return result;
    }
    
    lastError = result;
    
    if (!result.retryable) {
      return result;
    }
    
    // Exponential backoff: 1s, 2s, 4s, etc.
    const delay = Math.pow(2, attempt) * 1000;
    console.log(`   Retry ${attempt + 1}/${maxRetries} in ${delay}ms...`);
    await sleep(delay);
  }
  
  return lastError || {
    error: true,
    message: 'Max retries exceeded',
    retryable: false,
  };
}

/**
 * Helper function to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Checks if a result is an error
 */
export function isGeocodeError(result: GeocodeResult | GeocodeError): result is GeocodeError {
  return 'error' in result && result.error === true;
}

