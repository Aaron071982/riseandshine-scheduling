import { parse } from "csv-parse/sync";
import * as fs from "fs";
import * as path from "path";
import { normalizeBorough } from "../location";
import { geocodeAddress } from "./maps";

export type Client = {
  id: string;
  name: string;
  status?: string;
  phone?: string;
  age?: number | null;
  address_line: string;
  city: string;
  state: string;
  zip: string;
  locationBorough: string;
  lat?: number | null;
  lng?: number | null;
  cinNumber?: string;
  insurance?: string;
  notes?: string;
  needsLocationInfo?: boolean; // Flag for clients missing location
};

/**
 * Extracts zip code from address string
 */
function extractZipCode(address: string): string {
  const zipMatch = address.match(/\b(\d{5})\b/);
  return zipMatch ? zipMatch[1] : '';
}

/**
 * Extracts city and state from address
 */
function parseAddress(address: string): { city: string; state: string; zip: string; addressLine: string } {
  if (!address || address.trim() === '') {
    return { city: '', state: '', zip: '', addressLine: '' };
  }

  const zip = extractZipCode(address);
  
  // Try to extract city and state
  // Common patterns: "City, State ZIP" or "City State ZIP"
  const cityStateMatch = address.match(/([^,]+?),\s*([A-Z]{2})\s+(\d{5})/);
  if (cityStateMatch) {
    return {
      addressLine: address.split(',')[0].trim(),
      city: cityStateMatch[1].trim(),
      state: cityStateMatch[2],
      zip: cityStateMatch[3]
    };
  }

  // Fallback: try to extract from common NYC patterns
  const borough = normalizeBorough(address);
  let city = borough;
  let state = 'NY';
  
  if (address.includes('Brooklyn')) city = 'Brooklyn';
  else if (address.includes('Queens')) city = 'Queens';
  else if (address.includes('Manhattan')) city = 'Manhattan';
  else if (address.includes('Staten Island')) city = 'Staten Island';
  else if (address.includes('Bronx')) city = 'Bronx';
  else if (address.includes('Hicksville')) { city = 'Hicksville'; state = 'NY'; }
  else if (address.includes('Valley Stream')) { city = 'Valley Stream'; state = 'NY'; }
  else if (address.includes('Jamaica')) city = 'Jamaica';

  return {
    addressLine: address.split(',')[0].trim(),
    city,
    state,
    zip
  };
}

/**
 * Loads clients from CSV file
 */
export async function loadClientsFromCsv(csvPath?: string): Promise<Client[]> {
  const filePath = csvPath || path.join(__dirname, "..", "..", "Clients - Sheet1.csv");
  
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️ Clients CSV not found at ${filePath}, trying alternative path...`);
    const altPath = path.join(__dirname, "..", "..", "clients.csv");
    if (fs.existsSync(altPath)) {
      return loadClientsFromCsv(altPath);
    }
    console.error(`❌ Clients CSV not found. Please ensure the file exists.`);
    return [];
  }

  const fileContent = fs.readFileSync(filePath, "utf-8");
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true
  });

  const clients: Client[] = [];
  let idCounter = 1;

  for (const record of records) {
    const name = record["Clients"] || record["Client"] || "";
    if (!name || name.trim() === "" || name.startsWith('.')) {
      continue;
    }

    const locationText = record["Location"] || record["location"] || "";
    const borough = normalizeBorough(locationText);
    
    // Parse address information
    const addressInfo = parseAddress(locationText);
    
    // Check if location info is missing
    const needsLocationInfo = !locationText || locationText.trim() === '' || borough === "Unknown";

    // Extract other info
    const phone = record["Numbers"] || record["Phone"] || "";
    const ageText = record["Age"] || "";
    const age = ageText ? parseInt(ageText.split('→')[0].trim()) : null;
    const cinNumber = record["CIN number"] || record["CIN"] || "";
    const insurance = record["Insurance"] || "";
    const status = record["Status"] || "";
    const notes = record["Notes"] || "";

    const client: Client = {
      id: `client-${idCounter++}`,
      name: name.trim(),
      status,
      phone: phone.trim() || undefined,
      age,
      address_line: addressInfo.addressLine || locationText || '',
      city: addressInfo.city || borough,
      state: addressInfo.state || 'NY',
      zip: addressInfo.zip || '',
      locationBorough: borough !== "Unknown" ? borough : "Unknown",
      cinNumber: cinNumber || undefined,
      insurance: insurance || undefined,
      notes: notes || undefined,
      needsLocationInfo
    };

    // Try to geocode if we have an address
    if (locationText && !needsLocationInfo) {
      try {
        const coords = await geocodeAddress(locationText);
        if (coords) {
          client.lat = coords.lat;
          client.lng = coords.lng;
        }
      } catch (error) {
        console.warn(`Failed to geocode ${client.name}: ${error}`);
      }
    }

    clients.push(client);
  }

  return clients;
}

