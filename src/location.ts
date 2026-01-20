/**
 * Normalizes location text to borough names.
 * Extracts borough from addresses or location strings.
 * 
 * This is used primarily for NYC-based scheduling to map addresses/neighborhoods
 * to one of the five boroughs: Brooklyn, Queens, Manhattan, Bronx, Staten Island.
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
