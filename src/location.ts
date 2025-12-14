import { RBTProfile, ClientProfile } from "./models";

/**
 * Normalizes location text to borough names.
 * Extracts borough from addresses or location strings.
 */
export function normalizeBorough(locationText: string | undefined | null): string {
  if (!locationText) {
    return "Unknown";
  }

  const text = locationText.toLowerCase();
  
  // Check for explicit borough mentions
  if (text.includes("brooklyn")) return "Brooklyn";
  if (text.includes("queens")) return "Queens";
  if (text.includes("bronx")) return "Bronx";
  if (text.includes("manhattan") || text.includes("new york, ny")) return "Manhattan";
  if (text.includes("staten island")) return "Staten Island";
  
  // Check for specific neighborhoods that map to boroughs
  if (text.includes("hicksville") || text.includes("valley stream")) return "Queens"; // Long Island areas often treated as Queens
  if (text.includes("jamaica")) return "Queens";
  if (text.includes("far rockaway") || text.includes("far rockawar")) return "Queens";
  
  return "Unknown";
}

/**
 * Travel feasibility rules based on borough compatibility.
 * Represents "likely ≤ 30-45 minutes by car or public transit".
 * 
 * TODO: In production, replace with real travel time API (Google Maps, etc.)
 */
const TRAVEL_FEASIBLE_MATRIX: Record<string, string[]> = {
  "Brooklyn": ["Brooklyn", "Queens", "Manhattan", "Staten Island"],
  "Queens": ["Queens", "Brooklyn", "Manhattan", "Bronx"],
  "Manhattan": ["Manhattan", "Queens", "Bronx", "Brooklyn"],
  "Bronx": ["Bronx", "Manhattan", "Queens"],
  "Staten Island": ["Staten Island", "Brooklyn", "Manhattan"],
  "Unknown": [] // Unknown locations are not feasible
};

/**
 * Determines if travel between RBT and Client locations is feasible.
 * 
 * @param rbt RBT profile
 * @param client Client profile
 * @returns true if travel is likely ≤ 30-45 minutes
 */
export function isTravelFeasible(rbt: RBTProfile, client: ClientProfile): boolean {
  const rbtBorough = rbt.locationBorough;
  const clientBorough = client.locationBorough;
  
  // Same borough is always feasible
  if (rbtBorough === clientBorough && rbtBorough !== "Unknown") {
    return true;
  }
  
  // Check if client borough is in RBT's feasible list
  const feasibleBoroughs = TRAVEL_FEASIBLE_MATRIX[rbtBorough] || [];
  return feasibleBoroughs.includes(clientBorough);
}
