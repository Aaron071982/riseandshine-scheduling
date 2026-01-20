/**
 * Address Normalization Pipeline
 * 
 * Standardizes and parses US address strings for consistent geocoding.
 * US-generic - no city/region-specific assumptions.
 */

export interface NormalizedAddress {
  // Original input
  original: string;
  
  // Parsed components
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  
  // Quality indicators
  hasStreetNumber: boolean;
  hasStreetName: boolean;
  hasCity: boolean;
  hasState: boolean;
  hasZip: boolean;
  
  // Best string to geocode
  geocodeString: string;
  geocodeMethod: 'full_address' | 'zip_only' | 'city_state';
}

// US State abbreviations (all 50 states + DC + territories)
const STATE_ABBREVIATIONS: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY',
  // DC and territories
  'district of columbia': 'DC', 'washington dc': 'DC', 'washington d.c.': 'DC',
  'puerto rico': 'PR', 'guam': 'GU', 'virgin islands': 'VI',
  'american samoa': 'AS', 'northern mariana islands': 'MP',
};

// Valid 2-letter state codes for validation
const VALID_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'GU', 'VI', 'AS', 'MP'
]);

// Common street type abbreviations for detection
const STREET_TYPES = [
  'st', 'street', 'ave', 'avenue', 'rd', 'road', 'blvd', 'boulevard',
  'dr', 'drive', 'ln', 'lane', 'pl', 'place', 'ct', 'court', 'way',
  'pkwy', 'parkway', 'cir', 'circle', 'ter', 'terrace', 'trl', 'trail',
  'hwy', 'highway', 'expy', 'expressway', 'fwy', 'freeway'
];

const STREET_TYPE_REGEX = new RegExp(
  `\\b(${STREET_TYPES.join('|')}|\\d+(st|nd|rd|th))\\b`,
  'i'
);

/**
 * Normalizes and parses a US address string
 */
export function normalizeAddress(input: string | null | undefined): NormalizedAddress {
  const original = (input || '').trim();
  
  if (!original) {
    return {
      original: '',
      streetAddress: null,
      city: null,
      state: null,
      zip: null,
      hasStreetNumber: false,
      hasStreetName: false,
      hasCity: false,
      hasState: false,
      hasZip: false,
      geocodeString: '',
      geocodeMethod: 'city_state',
    };
  }
  
  // Clean the input
  let cleaned = original
    .replace(/\s+/g, ' ')           // Normalize whitespace
    .replace(/[""]/g, '"')          // Normalize quotes
    .replace(/['']/g, "'")          // Normalize apostrophes
    .replace(/\s*,\s*/g, ', ')      // Normalize comma spacing
    .trim();
  
  // Extract ZIP code (5 digits, optionally with -4 extension)
  const zipMatch = cleaned.match(/\b(\d{5})(?:-\d{4})?\b/);
  const zip = zipMatch ? zipMatch[1] : null;
  
  // Extract state - try multiple patterns
  let state: string | null = null;
  
  // Pattern 1: 2-letter state code before ZIP or at end
  const stateCodeMatch = cleaned.match(/,?\s*([A-Z]{2})\s*(?:\d{5}|$)/i);
  if (stateCodeMatch && VALID_STATE_CODES.has(stateCodeMatch[1].toUpperCase())) {
    state = stateCodeMatch[1].toUpperCase();
  }
  
  // Pattern 2: Full state name
  if (!state) {
    const lowerCleaned = cleaned.toLowerCase();
    for (const [fullName, abbrev] of Object.entries(STATE_ABBREVIATIONS)) {
      if (lowerCleaned.includes(fullName)) {
        state = abbrev;
        break;
      }
    }
  }
  
  // Extract city - look for pattern: "City, ST" or "City, State"
  let city: string | null = null;
  
  // Try to extract city from comma-separated format
  // Pattern: "..., City, ST ZIP" or "..., City, ST"
  const cityStatePattern = /,\s*([^,]+?)\s*,?\s*[A-Z]{2}\s*(?:\d{5})?$/i;
  const cityMatch = cleaned.match(cityStatePattern);
  if (cityMatch) {
    city = cityMatch[1].trim();
  }
  
  // If no city found, try splitting by comma and taking second-to-last part
  if (!city) {
    const parts = cleaned.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      // The city is usually before the state
      for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i];
        // Skip if it's a state code or ZIP
        if (/^[A-Z]{2}$/i.test(part) || /^\d{5}/.test(part)) continue;
        // Skip if it contains a state code at the end
        if (/\s+[A-Z]{2}\s*\d{5}?$/i.test(part)) {
          // Extract city from "City ST" or "City ST ZIP"
          const cityFromPart = part.replace(/\s+[A-Z]{2}\s*\d{5}?$/i, '').trim();
          if (cityFromPart) {
            city = cityFromPart;
            break;
          }
        }
        // Otherwise this might be the city
        if (part && !STREET_TYPE_REGEX.test(part)) {
          city = part;
          break;
        }
      }
    }
  }
  
  // Extract street address (everything before city/state/zip)
  let streetAddress: string | null = null;
  const parts = cleaned.split(',');
  if (parts.length > 0) {
    const firstPart = parts[0].trim();
    // Check if it looks like a street address (starts with number or has street indicators)
    if (/^\d+/.test(firstPart) || STREET_TYPE_REGEX.test(firstPart)) {
      streetAddress = firstPart;
    }
  }
  
  // Determine quality indicators
  const hasStreetNumber = /^\d+/.test(streetAddress || '');
  const hasStreetName = STREET_TYPE_REGEX.test(streetAddress || '');
  const hasCity = !!city && city.length > 1;
  const hasState = !!state;
  const hasZip = !!zip;
  
  // Determine best geocoding method and string
  let geocodeString: string;
  let geocodeMethod: 'full_address' | 'zip_only' | 'city_state';
  
  if (hasStreetNumber && hasStreetName && (hasCity || hasZip) && hasState) {
    // Full address available
    geocodeMethod = 'full_address';
    const addressParts = [streetAddress];
    if (city) addressParts.push(city);
    if (state) addressParts.push(state);
    if (zip) addressParts.push(zip);
    geocodeString = addressParts.filter(Boolean).join(', ') + ', USA';
  } else if (hasZip) {
    // ZIP code available - use it
    geocodeMethod = 'zip_only';
    geocodeString = `${zip}, USA`;
  } else if (hasCity && hasState) {
    // City/state available
    geocodeMethod = 'city_state';
    geocodeString = `${city}, ${state}, USA`;
  } else if (hasState) {
    // Only state
    geocodeMethod = 'city_state';
    geocodeString = `${state}, USA`;
  } else {
    // Fallback to original with USA suffix
    geocodeMethod = 'city_state';
    geocodeString = cleaned ? `${cleaned}, USA` : '';
  }
  
  return {
    original,
    streetAddress,
    city,
    state,
    zip,
    hasStreetNumber,
    hasStreetName,
    hasCity,
    hasState,
    hasZip,
    geocodeString,
    geocodeMethod,
  };
}

/**
 * Builds a full address string from components
 */
export function buildAddressString(
  streetAddress: string | null,
  city: string | null,
  state: string | null,
  zip: string | null
): string {
  const parts: string[] = [];
  
  if (streetAddress) parts.push(streetAddress);
  if (city) parts.push(city);
  if (state) parts.push(state);
  if (zip) parts.push(zip);
  
  return parts.join(', ');
}

/**
 * Extracts just the ZIP code from an address string
 */
export function extractZipCode(address: string): string | null {
  const match = address.match(/\b(\d{5})(?:-\d{4})?\b/);
  return match ? match[1] : null;
}

/**
 * Validates a US state code
 */
export function isValidStateCode(code: string): boolean {
  return VALID_STATE_CODES.has(code.toUpperCase());
}

/**
 * Converts full state name to abbreviation
 */
export function stateNameToAbbrev(name: string): string | null {
  const lower = name.toLowerCase().trim();
  return STATE_ABBREVIATIONS[lower] || null;
}

/**
 * Determines if an address looks complete enough for accurate geocoding
 */
export function isAddressComplete(normalized: NormalizedAddress): boolean {
  return normalized.hasStreetNumber && 
         normalized.hasStreetName && 
         (normalized.hasCity || normalized.hasZip) &&
         normalized.hasState;
}

/**
 * Gets a quality score for the normalized address (0-1)
 */
export function getAddressQualityScore(normalized: NormalizedAddress): number {
  let score = 0;
  
  if (normalized.hasStreetNumber) score += 0.25;
  if (normalized.hasStreetName) score += 0.25;
  if (normalized.hasCity) score += 0.2;
  if (normalized.hasState) score += 0.15;
  if (normalized.hasZip) score += 0.15;
  
  return score;
}
