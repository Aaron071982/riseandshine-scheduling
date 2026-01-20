/**
 * Client Data Access Layer
 * 
 * This module handles fetching client data from the Scheduling database.
 * Falls back to CSV loading if database is not configured.
 */

import { parse } from "csv-parse/sync";
import * as fs from "fs";
import * as path from "path";
import { normalizeBorough } from "../location";
import { supabaseSched, isSchedulingDBConfigured } from './supabaseSched';
import { mapClientRowToClient } from './mappers/entities';

// Geocoding precision types
export type GeocodePrecision = 'ROOFTOP' | 'RANGE_INTERPOLATED' | 'GEOMETRIC_CENTER' | 'APPROXIMATE';
export type GeocodeSource = 'full_address' | 'zip_only' | 'city_state' | 'manual_pin' | 'hrm_import' | 'csv_import' | 'crm_import';

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
  needsLocationInfo?: boolean;
  // Geocoding metadata
  geocode_precision?: GeocodePrecision | null;
  geocode_confidence?: number | null;
  geocode_source?: GeocodeSource | null;
  geocode_updated_at?: string | null;
  geocode_address_used?: string | null;
  needs_location_verification?: boolean;
};

/**
 * Loads clients from the Scheduling database
 * Falls back to CRM (if configured) then CSV if database is not configured or empty
 * 
 * Fallback chain:
 * 1. Scheduling DB (canonical - synced from CRM)
 * 2. CRM directly (temporary fallback if Scheduling DB empty)
 * 3. CSV (dev fallback)
 * 
 * Production flow: CRM → Sync Job → Scheduling DB → Matching
 */
export async function loadClients(): Promise<Client[]> {
  // First: Try Scheduling DB canonical clients (synced from CRM)
  if (isSchedulingDBConfigured()) {
    const clients = await loadClientsFromSupabase();
    if (clients.length > 0) {
      return clients;
    }
    console.log('⚠️ No clients in Scheduling DB');
  }
  
  // Second: If Scheduling DB empty AND CRM configured → try CRM directly (temporary fallback)
  // Fail-safe: If CRM unavailable, continue to CSV without crashing
  try {
    const { isCrmDBConfigured, isCrmDBValidated, validateCrmDB } = await import('./supabaseCrm');
    const { loadClientsFromCrm } = await import('./scheduling/loadClientsFromCrm');
    
    if (isCrmDBConfigured()) {
      // Validate if not already validated
      if (!isCrmDBValidated()) {
        try {
          await validateCrmDB();
        } catch (error) {
          console.warn('⚠️ CRM DB validation failed, skipping CRM fallback');
          console.warn('   Matching will continue with last synced Scheduling DB clients or CSV');
          // Continue to CSV fallback - don't crash
        }
      }
      
      if (isCrmDBValidated()) {
        try {
          const crmClients = await loadClientsFromCrm();
          if (crmClients.length > 0) {
            console.log('⚠️ Using CRM directly as fallback (Scheduling DB empty)');
            console.log('   Consider running sync: POST /api/admin/scheduling/sync-clients');
            return crmClients;
          }
        } catch (crmError) {
          // CRM load failed - log but don't crash
          console.warn('⚠️ Failed to load clients from CRM:', crmError instanceof Error ? crmError.message : String(crmError));
          console.warn('   Matching will continue with last synced Scheduling DB clients or CSV');
          // Continue to CSV fallback
        }
      }
    }
  } catch (error) {
    // CRM not configured or error loading - continue to CSV fallback
    console.log('⚠️ CRM not configured or unavailable, falling back to CSV');
    console.log('   Matching will continue with available data');
  }
  
  // Third: CSV fallback (dev only)
  return await loadClientsFromCsv();
}

/**
 * Loads clients from Supabase Scheduling database
 */
async function loadClientsFromSupabase(): Promise<Client[]> {
  try {
    const { data, error } = await supabaseSched
      .from('clients')
      .select(`
        id, name, status, phone, email, age,
        address_line, city, state, zip, location_borough,
        lat, lng, geocode_precision, geocode_confidence, geocode_source, geocode_updated_at, geocode_address_used,
        needs_location_verification, cin_number, insurance_provider, notes
      `);

    if (error) {
      if (error.code === '42P01' || error.message.includes('does not exist')) {
        console.warn('⚠️ clients table not found in scheduling DB');
        console.warn('   Run the SQL schema setup and migrate clients from CSV');
        return [];
      }
      console.error('Error fetching clients from Scheduling DB:', error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    console.log(`\n📋 Fetched ${data.length} clients from Scheduling DB`);

    const clients: Client[] = data.map((row: any) => mapClientRowToClient(row));

    // Log summary
    const withCoords = clients.filter(c => c.lat && c.lng).length;
    const needsVerification = clients.filter(c => c.needs_location_verification).length;
    console.log(`   ${withCoords}/${clients.length} have coordinates`);
    if (needsVerification > 0) {
      console.log(`   ${needsVerification} need location verification`);
    }

    return clients;
  } catch (error) {
    console.error('Failed to fetch clients from Supabase:', error);
    return [];
  }
}

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
 * Loads clients from CSV file (legacy/fallback)
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

  console.log(`📂 Loading clients from CSV: ${filePath}`);

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
      needsLocationInfo,
      // No geocoding from CSV - will be done by migration script
      geocode_precision: null,
      geocode_confidence: null,
      geocode_source: 'csv_import',
      geocode_updated_at: null,
      geocode_address_used: null,
      needs_location_verification: needsLocationInfo,
    };

    clients.push(client);
  }

  console.log(`   Loaded ${clients.length} clients from CSV`);
  const needsLocation = clients.filter(c => c.needsLocationInfo).length;
  if (needsLocation > 0) {
    console.log(`   ${needsLocation} clients need location info`);
  }

  return clients;
}

/**
 * Updates client geocoding data in the Scheduling database
 * Also invalidates travel time cache for this client
 */
export async function updateClientGeocoding(
  id: string,
  lat: number,
  lng: number,
  precision: GeocodePrecision,
  confidence: number,
  source: GeocodeSource,
  addressUsed: string
): Promise<boolean> {
  if (!isSchedulingDBConfigured()) {
    console.warn('Cannot update client geocoding - Scheduling DB not configured');
    return false;
  }

  try {
    // Get old coordinates to check if they changed
    const { data: oldClient } = await supabaseSched
      .from('clients')
      .select('lat, lng')
      .eq('id', id)
      .single();

    const oldLat = oldClient?.lat ? parseFloat(oldClient.lat.toString()) : null;
    const oldLng = oldClient?.lng ? parseFloat(oldClient.lng.toString()) : null;
    const coordsChanged = oldLat !== lat || oldLng !== lng;

    const { error } = await supabaseSched
      .from('clients')
      .update({
        lat,
        lng,
        geocode_precision: precision,
        geocode_confidence: confidence,
        geocode_source: source,
        geocode_address_used: addressUsed,
        geocode_updated_at: new Date().toISOString(),
        needs_location_verification: precision === 'APPROXIMATE' || confidence < 0.5,
        coords_stale: false, // Clear stale flag when coordinates are updated
      })
      .eq('id', id);

    if (error) {
      console.error('Error updating client geocoding:', error);
      return false;
    }

    // Invalidate cache if coordinates changed
    if (coordsChanged) {
      const { invalidateCacheForEntity } = await import('./scheduling/travelTimeCache');
      await invalidateCacheForEntity('client', id);
      console.log(`   Invalidated travel time cache for client ${id.substring(0, 8)}...`);
    }

    return true;
  } catch (error) {
    console.error('Failed to update client geocoding:', error);
    return false;
  }
}

/**
 * Inserts a client into the Scheduling database
 */
export async function insertClient(client: Client): Promise<string | null> {
  if (!isSchedulingDBConfigured()) {
    console.warn('Cannot insert client - Scheduling DB not configured');
    return null;
  }

  try {
    const { data, error } = await supabaseSched
      .from('clients')
      .insert({
        name: client.name,
        status: client.status,
        phone: client.phone,
        age: client.age,
        address_line: client.address_line,
        city: client.city,
        state: client.state,
        zip: client.zip,
        location_borough: client.locationBorough,
        lat: client.lat,
        lng: client.lng,
        geocode_precision: client.geocode_precision,
        geocode_confidence: client.geocode_confidence,
        geocode_source: client.geocode_source,
        geocode_address_used: client.geocode_address_used,
        geocode_updated_at: client.geocode_updated_at,
        needs_location_verification: client.needs_location_verification,
        cin_number: client.cinNumber,
        insurance_provider: client.insurance,
        notes: client.notes,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error inserting client:', error);
      return null;
    }

    return data?.id || null;
  } catch (error) {
    console.error('Failed to insert client:', error);
    return null;
  }
}