/**
 * Entity Mappers
 * 
 * Provides consistent snake_case ↔ camelCase conversion for database rows.
 * Single source of truth for field name mapping.
 */

import type { Client } from '../clients';
import type { RBT } from '../rbts';
import type { ClientMatch } from '../scheduling/matcher';

/**
 * Maps a database row (snake_case) to Client type (camelCase)
 */
export function mapClientRowToClient(row: any): Client {
  return {
    id: row.id,
    name: row.name || '',
    status: row.status || undefined,
    phone: row.phone || undefined,
    age: row.age || null,
    address_line: row.address_line || '',
    city: row.city || '',
    state: row.state || 'NY',
    zip: row.zip || '',
    locationBorough: row.location_borough || 'Unknown',
    lat: row.lat ? parseFloat(row.lat) : null,
    lng: row.lng ? parseFloat(row.lng) : null,
    cinNumber: row.cin_number || undefined,
    insurance: row.insurance_provider || undefined,
    notes: row.notes || undefined,
    needsLocationInfo: !row.lat || !row.lng || row.needs_location_verification,
    geocode_precision: row.geocode_precision || null,
    geocode_confidence: row.geocode_confidence ? parseFloat(row.geocode_confidence) : null,
    geocode_source: row.geocode_source || null,
    geocode_updated_at: row.geocode_updated_at || null,
    geocode_address_used: row.geocode_address_used || null,
    needs_location_verification: row.needs_location_verification || false,
  };
}

/**
 * Maps a database row (snake_case) to RBT type (camelCase)
 */
export function mapRbtRowToRbt(row: any): RBT {
  const fullName = row.full_name || 
    [row.first_name, row.last_name].filter(Boolean).join(' ').trim() ||
    row.email?.split('@')[0] || 
    `RBT-${row.id?.substring(0, 8) || 'Unknown'}`;

  const addressLine = row.address_line1 
    ? [row.address_line1, row.address_line2].filter(Boolean).join(', ').trim()
    : null;

  // Normalize transport mode
  const transportMode = normalizeTransportMode(row.transport_mode);

  return {
    id: row.id,
    full_name: fullName,
    first_name: row.first_name,
    last_name: row.last_name,
    address_line: addressLine,
    city: row.city || null,
    state: row.state || null,
    zip: row.zip_code || null,
    lat: row.lat ? parseFloat(row.lat) : null,
    lng: row.lng ? parseFloat(row.lng) : null,
    is_active: row.is_active !== false,
    transport_mode: transportMode,
    gender: row.gender || null,
    travelMode: transportMode === 'Both' ? 'HYBRID' : transportMode === 'Transit' ? 'TRANSIT' : 'DRIVING',
    email: row.email || null,
    phone: row.phone || null,
    fortyHourCourseComplete: row.forty_hour_course_completed || false,
    fortyHourCourseLink: row.forty_hour_course_link || null,
    geocode_precision: row.geocode_precision || null,
    geocode_confidence: row.geocode_confidence ? parseFloat(row.geocode_confidence) : null,
    geocode_source: row.geocode_source || null,
    geocode_updated_at: row.geocode_updated_at || null,
    geocode_address_used: row.geocode_address_used || null,
    hrm_id: row.hrm_id || null,
  };
}

/**
 * Normalizes transport mode string to valid enum value
 */
function normalizeTransportMode(mode: string | null | undefined): 'Car' | 'Transit' | 'Both' {
  if (!mode) return 'Both';
  
  const normalized = mode.toString().toLowerCase();
  if (normalized.includes('car') && normalized.includes('transit') || normalized.includes('both') || normalized.includes('hybrid')) {
    return 'Both';
  } else if (normalized.includes('transit') || normalized.includes('public')) {
    return 'Transit';
  } else if (normalized.includes('car') || normalized.includes('driving')) {
    return 'Car';
  }
  return 'Both';
}

/**
 * Maps a ClientMatch to frontend-friendly format (camelCase)
 */
export function mapMatchToFrontend(match: ClientMatch): any {
  return {
    clientId: match.client.id,
    clientName: match.client.name,
    clientLocation: match.client.locationBorough,
    clientAddress: match.client.address_line || `${match.client.city}, ${match.client.state} ${match.client.zip}`.trim(),
    clientZip: match.client.zip,
    clientStatus: match.client.status,
    clientNeedsLocation: match.client.needsLocationInfo,
    clientLat: match.client.lat || null,
    clientLng: match.client.lng || null,
    clientGeocodePrecision: match.client.geocode_precision || null,
    clientGeocodeConfidence: match.client.geocode_confidence || null,
    rbtId: match.rbt?.id || null,
    rbtName: match.rbt?.full_name || null,
    rbtLocation: match.rbt ? `${match.rbt.city || ''}, ${match.rbt.state || ''} ${match.rbt.zip || ''}`.trim() : null,
    rbtZip: match.rbt?.zip || null,
    rbtLat: match.rbt?.lat || null,
    rbtLng: match.rbt?.lng || null,
    rbtGeocodePrecision: match.rbt?.geocode_precision || null,
    rbtGeocodeConfidence: match.rbt?.geocode_confidence || null,
    travelTimeMinutes: match.travelTimeMinutes,
    travelTimeSeconds: match.travelTimeSeconds,
    distanceMiles: match.distanceMiles,
    status: match.status,
    reason: match.reason,
    travelMode: match.travelMode || (match.rbt?.transport_mode === 'Transit' ? 'transit' : match.rbt?.transport_mode === 'Both' ? 'driving' : 'driving'),
    rbtTransportMode: match.rbt?.transport_mode || 'Both',
    rbtGender: match.rbt?.gender || null,
    needsReview: match.needsReview || false,
    reviewReason: match.reviewReason || null,
    explain: match.explain || null,
    warnings: match.warnings || [],
  };
}

/**
 * Maps RBT to frontend format (camelCase)
 */
export function mapRbtToFrontend(rbt: RBT): any {
  return {
    id: rbt.id,
    name: rbt.full_name,
    location: `${rbt.city || ''}, ${rbt.state || ''} ${rbt.zip || ''}`.trim() || 'No location',
    zip: rbt.zip,
    lat: rbt.lat,
    lng: rbt.lng,
    geocodePrecision: rbt.geocode_precision || null,
    geocodeConfidence: rbt.geocode_confidence || null,
    transportMode: rbt.transport_mode || 'Both',
    gender: rbt.gender || null,
    fortyHourCourseComplete: rbt.fortyHourCourseComplete || false,
    fortyHourCourseLink: rbt.fortyHourCourseLink || null,
    email: rbt.email,
    phone: rbt.phone,
  };
}

/**
 * Maps Client to frontend format (camelCase)
 */
export function mapClientToFrontend(client: Client): any {
  return {
    id: client.id,
    name: client.name,
    location: client.locationBorough,
    address: client.address_line || `${client.city}, ${client.state} ${client.zip}`.trim() || 'No address',
    zip: client.zip,
    lat: client.lat || null,
    lng: client.lng || null,
    geocodePrecision: client.geocode_precision || null,
    geocodeConfidence: client.geocode_confidence || null,
    status: client.status,
    needsLocationInfo: client.needsLocationInfo,
    needsLocationVerification: client.needs_location_verification || false,
  };
}

