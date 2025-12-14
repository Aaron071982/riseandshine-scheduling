import { RBTProfile, ClientProfile } from "./models";

/**
 * Estimates travel time in minutes between two boroughs.
 * This is a simplified estimation - in production, use Google Maps Distance Matrix API.
 */
export function estimateTravelTime(
  rbtBorough: string,
  clientBorough: string,
  transportMode: "Car" | "PublicTransit" | "Either"
): number {
  // Same borough: 10-15 minutes
  if (rbtBorough === clientBorough) {
    return transportMode === "PublicTransit" ? 15 : 10;
  }

  // Borough-to-borough estimates (in minutes)
  const boroughPairs: Record<string, Record<string, { car: number; transit: number }>> = {
    "Brooklyn": {
      "Queens": { car: 25, transit: 35 },
      "Manhattan": { car: 20, transit: 30 },
      "Bronx": { car: 35, transit: 50 },
      "Staten Island": { car: 40, transit: 60 }
    },
    "Queens": {
      "Brooklyn": { car: 25, transit: 35 },
      "Manhattan": { car: 25, transit: 30 },
      "Bronx": { car: 30, transit: 45 }
    },
    "Manhattan": {
      "Brooklyn": { car: 20, transit: 30 },
      "Queens": { car: 25, transit: 30 },
      "Bronx": { car: 20, transit: 30 }
    },
    "Bronx": {
      "Brooklyn": { car: 35, transit: 50 },
      "Queens": { car: 30, transit: 45 },
      "Manhattan": { car: 20, transit: 30 }
    },
    "Staten Island": {
      "Brooklyn": { car: 40, transit: 60 },
      "Manhattan": { car: 45, transit: 70 }
    }
  };

  const times = boroughPairs[rbtBorough]?.[clientBorough];
  if (!times) {
    // Default: 30 minutes
    return transportMode === "PublicTransit" ? 40 : 30;
  }

  if (transportMode === "Car") {
    return times.car;
  } else if (transportMode === "PublicTransit") {
    return times.transit;
  } else {
    // "Either" - use the faster option
    return Math.min(times.car, times.transit);
  }
}

/**
 * Checks if travel time meets the requirements based on transport mode:
 * - PublicTransit: ≤ 15 minutes (closest match)
 * - Car: 20-30 minutes (optimal range)
 * - Either: ≤ 30 minutes
 */
export function isTravelTimeAcceptable(
  travelTimeMinutes: number,
  transportMode: "Car" | "PublicTransit" | "Either"
): boolean {
  if (transportMode === "PublicTransit") {
    return travelTimeMinutes <= 15;
  } else if (transportMode === "Car") {
    return travelTimeMinutes >= 20 && travelTimeMinutes <= 30;
  } else {
    // "Either" - accept up to 30 minutes
    return travelTimeMinutes <= 30;
  }
}

/**
 * Calculates travel time score for matching priority.
 * Lower score = better match (closer to ideal travel time).
 */
export function calculateTravelTimeScore(
  travelTimeMinutes: number,
  transportMode: "Car" | "PublicTransit" | "Either"
): number {
  if (transportMode === "PublicTransit") {
    // Prefer closest (≤ 15 min), penalize anything over
    return travelTimeMinutes <= 15 ? travelTimeMinutes : travelTimeMinutes * 10;
  } else if (transportMode === "Car") {
    // Prefer 20-30 min range, penalize outside
    if (travelTimeMinutes >= 20 && travelTimeMinutes <= 30) {
      // Ideal range: score based on how close to 25 minutes (middle)
      return Math.abs(travelTimeMinutes - 25);
    } else {
      // Outside ideal range: heavy penalty
      return 100 + Math.abs(travelTimeMinutes - 25);
    }
  } else {
    // "Either" - prefer shorter times
    return travelTimeMinutes;
  }
}

