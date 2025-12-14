/**
 * Data enrichment utilities to add placeholder addresses and random transport modes
 */

export interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
  fullAddress: string;
}

// Sample addresses by borough for realistic placeholder data
const BROOKLYN_ADDRESSES: Address[] = [
  { street: "1420 Avenue P, Apt 3B", city: "Brooklyn", state: "NY", zip: "11229", fullAddress: "1420 Avenue P, Apt 3B, Brooklyn, NY 11229" },
  { street: "1855 Coney Island Ave, Apt 2F", city: "Brooklyn", state: "NY", zip: "11230", fullAddress: "1855 Coney Island Ave, Apt 2F, Brooklyn, NY 11230" },
  { street: "8923 20th Avenue, 1st Floor", city: "Brooklyn", state: "NY", zip: "11214", fullAddress: "8923 20th Avenue, 1st Floor, Brooklyn, NY 11214" },
  { street: "3465 Nostrand Avenue, Apt 4C", city: "Brooklyn", state: "NY", zip: "11229", fullAddress: "3465 Nostrand Avenue, Apt 4C, Brooklyn, NY 11229" },
  { street: "2714 Kings Highway, Apt 5D", city: "Brooklyn", state: "NY", zip: "11234", fullAddress: "2714 Kings Highway, Apt 5D, Brooklyn, NY 11234" },
  { street: "5823 Bay Parkway, Apt 2B", city: "Brooklyn", state: "NY", zip: "11204", fullAddress: "5823 Bay Parkway, Apt 2B, Brooklyn, NY 11204" },
  { street: "9321 18th Avenue, Ground Floor", city: "Brooklyn", state: "NY", zip: "11228", fullAddress: "9321 18th Avenue, Ground Floor, Brooklyn, NY 11228" },
  { street: "2847 Avenue U, Apt 3A", city: "Brooklyn", state: "NY", zip: "11229", fullAddress: "2847 Avenue U, Apt 3A, Brooklyn, NY 11229" },
  { street: "1652 86th Street, Apt 4F", city: "Brooklyn", state: "NY", zip: "11214", fullAddress: "1652 86th Street, Apt 4F, Brooklyn, NY 11214" },
  { street: "4201 Flatbush Avenue, Apt 2C", city: "Brooklyn", state: "NY", zip: "11234", fullAddress: "4201 Flatbush Avenue, Apt 2C, Brooklyn, NY 11234" },
];

const QUEENS_ADDRESSES: Address[] = [
  { street: "8923 Queens Boulevard, Apt 5B", city: "Queens", state: "NY", zip: "11373", fullAddress: "8923 Queens Boulevard, Apt 5B, Queens, NY 11373" },
  { street: "1245 Astoria Boulevard, 2nd Floor", city: "Queens", state: "NY", zip: "11102", fullAddress: "1245 Astoria Boulevard, 2nd Floor, Queens, NY 11102" },
  { street: "3678 Junction Boulevard, Apt 3D", city: "Queens", state: "NY", zip: "11368", fullAddress: "3678 Junction Boulevard, Apt 3D, Queens, NY 11368" },
  { street: "5129 Northern Boulevard, Apt 2A", city: "Queens", state: "NY", zip: "11377", fullAddress: "5129 Northern Boulevard, Apt 2A, Queens, NY 11377" },
  { street: "1842 Rockaway Boulevard, Ground Floor", city: "Queens", state: "NY", zip: "11436", fullAddress: "1842 Rockaway Boulevard, Ground Floor, Queens, NY 11436" },
  { street: "2934 Jamaica Avenue, Apt 4C", city: "Queens", state: "NY", zip: "11432", fullAddress: "2934 Jamaica Avenue, Apt 4C, Queens, NY 11432" },
  { street: "6721 Main Street, Apt 3F", city: "Flushing", state: "NY", zip: "11355", fullAddress: "6721 Main Street, Apt 3F, Flushing, NY 11355" },
  { street: "8523 Hillside Avenue, Apt 2B", city: "Queens", state: "NY", zip: "11432", fullAddress: "8523 Hillside Avenue, Apt 2B, Queens, NY 11432" },
];

const MANHATTAN_ADDRESSES: Address[] = [
  { street: "2847 Broadway, Apt 4A", city: "New York", state: "NY", zip: "10025", fullAddress: "2847 Broadway, Apt 4A, New York, NY 10025" },
  { street: "1562 Amsterdam Avenue, Apt 3C", city: "New York", state: "NY", zip: "10031", fullAddress: "1562 Amsterdam Avenue, Apt 3C, New York, NY 10031" },
  { street: "3921 1st Avenue, Apt 2D", city: "New York", state: "NY", zip: "10010", fullAddress: "3921 1st Avenue, Apt 2D, New York, NY 10010" },
];

const STATEN_ISLAND_ADDRESSES: Address[] = [
  { street: "2847 Richmond Avenue, Apt 3B", city: "Staten Island", state: "NY", zip: "10314", fullAddress: "2847 Richmond Avenue, Apt 3B, Staten Island, NY 10314" },
  { street: "1562 Hylan Boulevard, Ground Floor", city: "Staten Island", state: "NY", zip: "10305", fullAddress: "1562 Hylan Boulevard, Ground Floor, Staten Island, NY 10305" },
  { street: "3921 Victory Boulevard, Apt 4C", city: "Staten Island", state: "NY", zip: "10301", fullAddress: "3921 Victory Boulevard, Apt 4C, Staten Island, NY 10301" },
];

const BRONX_ADDRESSES: Address[] = [
  { street: "2847 Grand Concourse, Apt 2A", city: "Bronx", state: "NY", zip: "10458", fullAddress: "2847 Grand Concourse, Apt 2A, Bronx, NY 10458" },
  { street: "1562 Fordham Road, Apt 3D", city: "Bronx", state: "NY", zip: "10458", fullAddress: "1562 Fordham Road, Apt 3D, Bronx, NY 10458" },
  { street: "3921 White Plains Road, Apt 4B", city: "Bronx", state: "NY", zip: "10467", fullAddress: "3921 White Plains Road, Apt 4B, Bronx, NY 10467" },
];

const ADDRESS_BY_BOROUGH: Record<string, Address[]> = {
  "Brooklyn": BROOKLYN_ADDRESSES,
  "Queens": QUEENS_ADDRESSES,
  "Manhattan": MANHATTAN_ADDRESSES,
  "Staten Island": STATEN_ISLAND_ADDRESSES,
  "Bronx": BRONX_ADDRESSES,
};

let addressCounter = 0;

/**
 * Generates a placeholder address for a given borough
 */
export function generatePlaceholderAddress(borough: string): Address {
  const addresses = ADDRESS_BY_BOROUGH[borough] || BROOKLYN_ADDRESSES;
  const index = addressCounter % addresses.length;
  addressCounter++;
  return { ...addresses[index] };
}

/**
 * Parses an address string or generates a placeholder
 */
export function parseOrGenerateAddress(locationText: string | undefined | null, borough: string): Address {
  if (locationText && locationText.trim() !== "") {
    // Try to parse existing address
    const text = locationText.trim();
    
    // Check if it already looks like a full address
    if (text.includes(",") && text.includes("NY")) {
      // Extract components if possible
      const parts = text.split(",").map(p => p.trim());
      if (parts.length >= 3) {
        return {
          street: parts[0],
          city: parts[1] || borough,
          state: "NY",
          zip: parts[2]?.match(/\d{5}/)?.[0] || "10001",
          fullAddress: text
        };
      }
    }
    
    // If it has street info, use it
    if (text.match(/\d+.*(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Court|Ct|Drive|Dr|Lane|Ln)/i)) {
      const zipMatch = text.match(/(\d{5})/);
      const zip = zipMatch ? zipMatch[1] : "10001";
      return {
        street: text.split(",")[0].trim(),
        city: borough,
        state: "NY",
        zip,
        fullAddress: text
      };
    }
  }
  
  // Generate placeholder
  return generatePlaceholderAddress(borough);
}

/**
 * Randomly assigns a transport mode to an RBT
 */
export function assignRandomTransportMode(): "Car" | "PublicTransit" | "Either" {
  const rand = Math.random();
  if (rand < 0.3) return "Car";
  if (rand < 0.6) return "PublicTransit";
  return "Either";
}

