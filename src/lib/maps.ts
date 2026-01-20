// Load dotenv only if GOOGLE_MAPS_API_KEY not already set
if (!process.env.GOOGLE_MAPS_API_KEY) {
  try {
    const dotenv = require('dotenv');
    dotenv.config();
  } catch (e) {
    // dotenv not available or already loaded - that's fine
  }
}

export type LatLng = { lat: number; lng: number };

const API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

/**
 * Geocodes an address to lat/lng coordinates
 */
export async function geocodeAddress(address: string): Promise<LatLng | null> {
  if (!API_KEY) {
    console.warn('Google Maps API key not found, using fallback geocoding');
    return geocodeAddressFallback(address);
  }

  try {
    const params = new URLSearchParams({
      address: address,
      key: API_KEY
    });

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`
    );

    if (!response.ok) {
      console.warn(`Geocoding API error: ${response.status}`);
      return geocodeAddressFallback(address);
    }

    const data = await response.json() as any;

    if (data.status === 'OK' && data.results && data.results.length > 0) {
      const location = data.results[0].geometry.location;
      return {
        lat: location.lat,
        lng: location.lng
      };
    }

    return geocodeAddressFallback(address);
  } catch (error) {
    console.error('Error geocoding address:', error);
    return geocodeAddressFallback(address);
  }
}

/**
 * Fallback geocoding using borough/zip code estimation
 */
function geocodeAddressFallback(address: string): LatLng | null {
  const addr = address.toLowerCase();
  
  // Extract zip code if present
  const zipMatch = address.match(/\b(\d{5})\b/);
  if (zipMatch) {
    const zip = zipMatch[1];
    // Use zip code center coordinates (simplified)
    return getZipCodeCoordinates(zip);
  }

  // Borough-based fallback
  if (addr.includes('brooklyn')) return { lat: 40.6782, lng: -73.9442 };
  if (addr.includes('queens')) return { lat: 40.7282, lng: -73.7949 };
  if (addr.includes('manhattan') || addr.includes('new york, ny')) return { lat: 40.7831, lng: -73.9712 };
  if (addr.includes('staten island')) return { lat: 40.5795, lng: -74.1502 };
  if (addr.includes('bronx')) return { lat: 40.8448, lng: -73.8648 };
  if (addr.includes('hicksville') || addr.includes('valley stream')) return { lat: 40.7684, lng: -73.5251 };
  if (addr.includes('jamaica')) return { lat: 40.6915, lng: -73.8057 };
  if (addr.includes('far rockaway')) return { lat: 40.6054, lng: -73.7558 };

  return null;
}

/**
 * Gets approximate coordinates for a zip code
 */
function getZipCodeCoordinates(zip: string): LatLng {
  // NYC zip code approximations (simplified)
  const zipCoords: Record<string, LatLng> = {
    '11201': { lat: 40.6943, lng: -73.9903 }, // Brooklyn Heights
    '11214': { lat: 40.6086, lng: -73.9972 }, // Brooklyn
    '11217': { lat: 40.6782, lng: -73.9794 }, // Brooklyn
    '11224': { lat: 40.5782, lng: -73.9781 }, // Brooklyn
    '11229': { lat: 40.6012, lng: -73.9442 }, // Brooklyn
    '11230': { lat: 40.6202, lng: -73.9681 }, // Brooklyn
    '11234': { lat: 40.6182, lng: -73.9201 }, // Brooklyn
    '11235': { lat: 40.5842, lng: -73.9442 }, // Brooklyn
    '10314': { lat: 40.5795, lng: -74.1502 }, // Staten Island
    '11430': { lat: 40.6915, lng: -73.8057 }, // Jamaica
    '11433': { lat: 40.6915, lng: -73.8057 }, // Jamaica
    '11580': { lat: 40.6643, lng: -73.7085 }, // Valley Stream
    '11801': { lat: 40.7684, lng: -73.5251 }, // Hicksville
  };

  return zipCoords[zip] || { lat: 40.7128, lng: -73.9352 }; // Default to NYC center
}

/**
 * Gets travel time in seconds using Google Maps Distance Matrix API
 */
export async function getTravelTimeSeconds(
  origin: LatLng,
  destination: LatLng,
  mode: 'driving' | 'transit' = 'driving'
): Promise<number | null> {
  if (!API_KEY) {
    console.warn('Google Maps API key not found, using fallback travel time');
    return estimateTravelTimeFallback(origin, destination, mode);
  }

  try {
    const params = new URLSearchParams({
      origins: `${origin.lat},${origin.lng}`,
      destinations: `${destination.lat},${destination.lng}`,
      key: API_KEY,
      mode: mode
    });

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`
    );

    if (!response.ok) {
      console.warn(`Distance Matrix API error: ${response.status}`);
      return estimateTravelTimeFallback(origin, destination, mode);
    }

    const data = await response.json() as any;

    if (data.status === 'OK' && data.rows && data.rows.length > 0) {
      const element = data.rows[0].elements?.[0];
      if (element && element.status === 'OK' && element.duration) {
        return element.duration.value; // in seconds
      }
    }

    return estimateTravelTimeFallback(origin, destination, mode);
  } catch (error) {
    console.error('Error calculating travel time:', error);
    return estimateTravelTimeFallback(origin, destination, mode);
  }
}

/**
 * Fallback travel time estimation based on distance
 */
function estimateTravelTimeFallback(
  origin: LatLng,
  destination: LatLng,
  mode: 'driving' | 'transit'
): number {
  // Calculate distance using Haversine formula
  const R = 6371e3; // Earth radius in meters
  const φ1 = origin.lat * Math.PI / 180;
  const φ2 = destination.lat * Math.PI / 180;
  const Δφ = (destination.lat - origin.lat) * Math.PI / 180;
  const Δλ = (destination.lng - origin.lng) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c; // in meters

  // Convert to miles
  const miles = distance / 1609.34;

  // Estimate time based on mode
  if (mode === 'transit') {
    return Math.round(miles * 3.5 * 60); // ~3.5 min per mile for transit
  } else {
    return Math.round(miles * 2.2 * 60); // ~2.2 min per mile for driving (city traffic)
  }
}

