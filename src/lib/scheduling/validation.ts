/**
 * Match Validation Service
 * 
 * Validates matches and flags suspicious results for review.
 * Checks for distance/time mismatches and geocoding quality issues.
 */

import type { ClientMatch } from './matcher';
import type { GeocodePrecision } from '../geocoding/geocode';

export interface ValidationResult {
  isValid: boolean;
  needsReview: boolean;
  reviewReasons: string[];
  warnings: string[];
}

// Validation thresholds
const SUSPICIOUS_SHORT_DISTANCE_MILES = 0.2;
const SUSPICIOUS_SHORT_DISTANCE_LONG_TIME_MIN = 20;
const SUSPICIOUS_LONG_DISTANCE_MILES = 60;
const SUSPICIOUS_LONG_DISTANCE_SHORT_TIME_MIN = 45;

/**
 * Validates a match and flags suspicious results
 */
export function validateMatch(match: ClientMatch): ValidationResult {
  const reviewReasons: string[] = [];
  const warnings: string[] = [];
  
  // Skip validation for unmatched clients
  if (!match.rbt || match.status === 'no_location' || match.status === 'standby') {
    return {
      isValid: true,
      needsReview: false,
      reviewReasons: [],
      warnings: [],
    };
  }
  
  const distanceMiles = match.distanceMiles || 0;
  const travelTimeMinutes = match.travelTimeMinutes || 0;
  
  // Check 1: Short distance but long travel time
  if (distanceMiles < SUSPICIOUS_SHORT_DISTANCE_MILES && travelTimeMinutes > SUSPICIOUS_SHORT_DISTANCE_LONG_TIME_MIN) {
    reviewReasons.push(
      `Distance is ${distanceMiles.toFixed(1)} miles but travel time is ${travelTimeMinutes} min - possible geocoding error`
    );
  }
  
  // Check 2: Long distance but short travel time
  if (distanceMiles > SUSPICIOUS_LONG_DISTANCE_MILES && travelTimeMinutes < SUSPICIOUS_LONG_DISTANCE_SHORT_TIME_MIN) {
    reviewReasons.push(
      `Distance is ${distanceMiles.toFixed(1)} miles but travel time is only ${travelTimeMinutes} min - verify route`
    );
  }
  
  // Check 3: Both locations have APPROXIMATE precision
  // Only flag if both are APPROXIMATE - one being approximate is just a warning
  const clientPrecision = match.client.geocode_precision;
  const rbtPrecision = match.rbt.geocode_precision;
  
  // Only check if precision is actually set (not null)
  if (clientPrecision && rbtPrecision) {
    if (clientPrecision === 'APPROXIMATE' && rbtPrecision === 'APPROXIMATE') {
      reviewReasons.push('Both client and RBT locations are approximate - verify both addresses');
    } else if (clientPrecision === 'APPROXIMATE') {
      warnings.push('Client location is approximate');
    } else if (rbtPrecision === 'APPROXIMATE') {
      warnings.push('RBT location is approximate');
    }
  }
  
  // Check 4: Low geocoding confidence (only flag if confidence is explicitly set and low)
  // Don't flag if confidence is null - that means it hasn't been geocoded yet
  const clientConfidence = match.client.geocode_confidence;
  const rbtConfidence = match.rbt.geocode_confidence;
  
  // Only check confidence if it's actually set (not null/undefined)
  if (clientConfidence !== null && clientConfidence !== undefined && 
      rbtConfidence !== null && rbtConfidence !== undefined) {
    if (clientConfidence < 0.5 && rbtConfidence < 0.5) {
      reviewReasons.push('Both locations have low geocoding confidence');
    } else if (clientConfidence < 0.5) {
      warnings.push(`Client geocoding confidence is low (${(clientConfidence * 100).toFixed(0)}%)`);
    } else if (rbtConfidence < 0.5) {
      warnings.push(`RBT geocoding confidence is low (${(rbtConfidence * 100).toFixed(0)}%)`);
    }
  }
  
  // Check 5: ZIP centroid used for either location
  const clientSource = match.client.geocode_source;
  const rbtSource = match.rbt.geocode_source;
  
  if (clientSource === 'zip_only' || rbtSource === 'zip_only') {
    // Check for borough mismatch
    const clientBorough = match.client.locationBorough?.toLowerCase() || '';
    const rbtCity = match.rbt.city?.toLowerCase() || '';
    
    if (clientBorough && rbtCity && !isSameArea(clientBorough, rbtCity)) {
      reviewReasons.push(
        `ZIP centroid used and locations may be in different areas: ${match.client.locationBorough} vs ${match.rbt.city}`
      );
    } else {
      warnings.push('Location geocoded from ZIP code only - street address missing');
    }
  }
  
  // Check 6: Missing coordinates
  // Don't flag missing coordinates as needsReview - coordinates are geocoded on-the-fly during matching
  // If travel time was calculated, coordinates exist (they're just not persisted yet)
  // Only warn if we have travel time but coordinates are still null (shouldn't happen)
  if (match.travelTimeSeconds && match.travelTimeSeconds > 0) {
    // If we calculated travel time, coordinates must have existed during calculation
    // They might not be persisted to DB yet, but that's fine - don't flag as needsReview
    if (!match.client.lat || !match.client.lng) {
      warnings.push('Client coordinates not persisted (travel time calculated indicates coords exist)');
    }
    if (!match.rbt || !match.rbt.lat || !match.rbt.lng) {
      warnings.push('RBT coordinates not persisted (travel time calculated indicates coords exist)');
    }
  }
  // If no travel time and no coordinates, that's handled by the standby/no_location status, not validation
  
  // Check 7: Travel time seems too long for the distance
  if (distanceMiles > 0 && travelTimeMinutes > 0) {
    const avgSpeedMph = (distanceMiles / travelTimeMinutes) * 60;
    if (avgSpeedMph < 5) {
      warnings.push(`Very slow average speed (${avgSpeedMph.toFixed(1)} mph) - heavy traffic or routing issue?`);
    }
  }
  
  const needsReview = reviewReasons.length > 0;
  
  return {
    isValid: !needsReview,
    needsReview,
    reviewReasons,
    warnings,
  };
}

/**
 * Checks if two area names refer to the same general area
 */
function isSameArea(area1: string, area2: string): boolean {
  // Normalize
  const a1 = area1.toLowerCase().trim();
  const a2 = area2.toLowerCase().trim();
  
  // Direct match
  if (a1 === a2) return true;
  
  // Brooklyn variations
  if ((a1.includes('brooklyn') || a1.includes('bklyn')) &&
      (a2.includes('brooklyn') || a2.includes('bklyn'))) {
    return true;
  }
  
  // Queens variations
  if ((a1.includes('queens') || a1.includes('jamaica') || a1.includes('flushing')) &&
      (a2.includes('queens') || a2.includes('jamaica') || a2.includes('flushing'))) {
    return true;
  }
  
  // Manhattan variations
  if ((a1.includes('manhattan') || a1.includes('new york')) &&
      (a2.includes('manhattan') || a2.includes('new york'))) {
    return true;
  }
  
  // Staten Island
  if (a1.includes('staten') && a2.includes('staten')) {
    return true;
  }
  
  // Bronx
  if (a1.includes('bronx') && a2.includes('bronx')) {
    return true;
  }
  
  return false;
}

/**
 * Gets a quality score for a match (0-1)
 * Higher is better
 */
export function getMatchQualityScore(match: ClientMatch): number {
  if (!match.rbt || match.status === 'no_location' || match.status === 'standby') {
    return 0;
  }
  
  let score = 1.0;
  
  // Deduct for geocoding quality
  const clientConfidence = match.client.geocode_confidence || 0.5;
  const rbtConfidence = match.rbt.geocode_confidence || 0.5;
  score *= (clientConfidence + rbtConfidence) / 2;
  
  // Deduct for APPROXIMATE precision
  if (match.client.geocode_precision === 'APPROXIMATE') score *= 0.7;
  if (match.rbt.geocode_precision === 'APPROXIMATE') score *= 0.7;
  
  // Deduct for ZIP-only geocoding
  if (match.client.geocode_source === 'zip_only') score *= 0.8;
  if (match.rbt.geocode_source === 'zip_only') score *= 0.8;
  
  // Bonus for manual verification
  if (match.client.geocode_source === 'manual_pin') score = Math.min(1, score * 1.2);
  if (match.rbt.geocode_source === 'manual_pin') score = Math.min(1, score * 1.2);
  
  return Math.round(score * 100) / 100;
}

/**
 * Gets location quality level for display
 */
export function getLocationQuality(
  precision: GeocodePrecision | null | undefined,
  confidence: number | null | undefined,
  source: string | null | undefined
): 'good' | 'medium' | 'bad' {
  // Manual pin is always good
  if (source === 'manual_pin') return 'good';
  
  // ROOFTOP or RANGE_INTERPOLATED with good confidence
  if ((precision === 'ROOFTOP' || precision === 'RANGE_INTERPOLATED') && 
      (confidence === null || confidence === undefined || confidence >= 0.7)) {
    return 'good';
  }
  
  // GEOMETRIC_CENTER (ZIP centroid) is medium
  if (precision === 'GEOMETRIC_CENTER') return 'medium';
  
  // APPROXIMATE or missing is bad
  if (precision === 'APPROXIMATE' || !precision) return 'bad';
  
  // Low confidence is medium at best
  if (confidence !== null && confidence !== undefined && confidence < 0.5) return 'medium';
  
  return 'medium';
}

/**
 * Batch validates matches and returns summary
 */
export function validateMatches(matches: ClientMatch[]): {
  valid: number;
  needsReview: number;
  warnings: number;
  issues: Array<{ match: ClientMatch; validation: ValidationResult }>;
} {
  let valid = 0;
  let needsReview = 0;
  let warnings = 0;
  const issues: Array<{ match: ClientMatch; validation: ValidationResult }> = [];
  
  for (const match of matches) {
    const validation = validateMatch(match);
    
    if (validation.needsReview) {
      needsReview++;
      issues.push({ match, validation });
    } else if (validation.warnings.length > 0) {
      warnings++;
      valid++;
    } else {
      valid++;
    }
  }
  
  return { valid, needsReview, warnings, issues };
}

