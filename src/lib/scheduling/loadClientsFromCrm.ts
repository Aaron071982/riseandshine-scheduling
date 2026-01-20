/**
 * CRM Client Data Loader
 * 
 * Loads clients from the CRM Supabase database (read-only).
 * Maps CRM schema fields to internal Client type.
 * 
 * FIELD MAPPING ASSUMPTIONS (documented for reference):
 * - CRM `id` → stored as `crm_id` in Scheduling DB, internal `id` uses `crm:<crm_id>` format
 * - CRM `name` or `full_name` → `name`
 * - CRM `address` or `address_line1` → `address_line`
 * - CRM `borough` or `location_borough` → `location_borough`
 * - CRM `zip_code` or `zip` → `zip`
 * - CRM `city` → `city`
 * - CRM `state` → `state`
 * - CRM `lat`, `lng` → `lat`, `lng` (if available)
 * - CRM `status` → `status` (filter for 'active' or similar)
 * - CRM `phone` or `phone_number` → `phone`
 * - CRM `email` → `email`
 * - CRM `age` → `age`
 * - CRM `notes` or `description` → `notes`
 */

import { getCrmClient, isCrmDBConfigured, isCrmDBValidated } from '../supabaseCrm';
import type { Client } from '../clients';
import { normalizeBorough } from '../../location';

/**
 * Loads active clients from CRM database
 * 
 * @returns Array of Client objects mapped from CRM schema
 */
export async function loadClientsFromCrm(): Promise<Client[]> {
  if (!isCrmDBConfigured()) {
    console.warn('⚠️ CRM DB not configured - cannot load clients from CRM');
    return [];
  }

  if (!isCrmDBValidated()) {
    console.warn('⚠️ CRM DB not validated - cannot load clients from CRM');
    return [];
  }

  try {
    const supabase = getCrmClient();
    
    // Fetch active clients from CRM
    // Assumes CRM has a 'clients' table with status field
    // Filter for active clients (adjust status values as needed)
    const { data, error } = await supabase
      .from('clients')
      .select(`
        id,
        name,
        full_name,
        address,
        address_line1,
        address_line,
        city,
        state,
        zip,
        zip_code,
        borough,
        location_borough,
        lat,
        lng,
        status,
        phone,
        phone_number,
        email,
        age,
        notes,
        description,
        updated_at
      `)
      .or('status.eq.active,status.eq.Active,status.is.null')
      .order('name', { ascending: true });

    if (error) {
      if (error.code === '42P01' || error.message.includes('does not exist')) {
        console.warn('⚠️ clients table not found in CRM DB');
        return [];
      }
      console.error('Error fetching clients from CRM:', error);
      return [];
    }

    if (!data || data.length === 0) {
      console.log('⚠️ No clients found in CRM');
      return [];
    }

    console.log(`\n📋 Fetched ${data.length} clients from CRM`);

    // Map CRM rows to Client type
    const clients: Client[] = data.map((row: any) => {
      // Map name (try multiple field names)
      const name = row.name || row.full_name || 'Unknown Client';
      
      // Map address fields
      const addressLine = row.address_line || row.address_line1 || row.address || '';
      const city = row.city || '';
      const state = row.state || 'NY';
      const zip = row.zip || row.zip_code || '';
      
      // Map borough (normalize to standard format)
      const boroughRaw = row.location_borough || row.borough || '';
      const locationBorough = boroughRaw ? normalizeBorough(boroughRaw) : 'Unknown';
      
      // Map coordinates (if available from CRM)
      const lat = row.lat ? parseFloat(row.lat) : null;
      const lng = row.lng ? parseFloat(row.lng) : null;
      
      // Map other fields
      const status = row.status || undefined;
      const phone = row.phone || row.phone_number || undefined;
      const email = row.email || undefined;
      const age = row.age ? parseInt(row.age, 10) : null;
      const notes = row.notes || row.description || undefined;
      
      // Create Client object with CRM source
      const client: Client = {
        id: `crm:${row.id}`, // Use crm: prefix for internal ID
        name: name.trim(),
        status,
        phone,
        age,
        address_line: addressLine.trim(),
        city: city.trim(),
        state: state.trim(),
        zip: zip.trim(),
        locationBorough,
        lat,
        lng,
        // Geocoding metadata - if CRM provided coords, mark as crm_import
        // Otherwise will be geocoded during sync
        geocode_precision: lat && lng ? 'ROOFTOP' : null, // Assume good if CRM provided
        geocode_confidence: lat && lng ? 0.9 : null, // High confidence if CRM provided
        geocode_source: lat && lng ? 'crm_import' : null,
        geocode_updated_at: row.updated_at || null,
        geocode_address_used: lat && lng ? `${addressLine}, ${city}, ${state} ${zip}`.trim() : null,
        needs_location_verification: !lat || !lng || locationBorough === 'Unknown',
        // Store original CRM ID for sync reference (will be stored in crm_id field during sync)
        // Note: This is a temporary field, actual crm_id will be stored in DB
      };

      return client;
    });

    // Log summary
    const withCoords = clients.filter(c => c.lat && c.lng).length;
    const needsVerification = clients.filter(c => c.needs_location_verification).length;
    console.log(`   ${withCoords}/${clients.length} have coordinates from CRM`);
    if (needsVerification > 0) {
      console.log(`   ${needsVerification} need geocoding`);
    }

    return clients;
  } catch (error) {
    console.error('Failed to fetch clients from CRM:', error);
    return [];
  }
}

/**
 * Gets a single client by CRM ID
 * 
 * @param crmId - The CRM client ID
 * @returns Client object or null if not found
 */
export async function getClientByCrmId(crmId: string): Promise<Client | null> {
  if (!isCrmDBConfigured() || !isCrmDBValidated()) {
    return null;
  }

  try {
    const supabase = getCrmClient();
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('id', crmId)
      .single();

    if (error || !data) {
      return null;
    }

    // Map single row (same logic as loadClientsFromCrm)
    const name = data.name || data.full_name || 'Unknown Client';
    const addressLine = data.address_line || data.address_line1 || data.address || '';
    const city = data.city || '';
    const state = data.state || 'NY';
    const zip = data.zip || data.zip_code || '';
    const boroughRaw = data.location_borough || data.borough || '';
    const locationBorough = boroughRaw ? normalizeBorough(boroughRaw) : 'Unknown';
    const lat = data.lat ? parseFloat(data.lat) : null;
    const lng = data.lng ? parseFloat(data.lng) : null;

    return {
      id: `crm:${data.id}`,
      name: name.trim(),
      status: data.status || undefined,
      phone: data.phone || data.phone_number || undefined,
      age: data.age ? parseInt(data.age, 10) : null,
      address_line: addressLine.trim(),
      city: city.trim(),
      state: state.trim(),
      zip: zip.trim(),
      locationBorough,
      lat,
      lng,
      geocode_precision: lat && lng ? 'ROOFTOP' : null,
      geocode_confidence: lat && lng ? 0.9 : null,
      geocode_source: lat && lng ? 'crm_import' : null,
      geocode_updated_at: data.updated_at || null,
      geocode_address_used: lat && lng ? `${addressLine}, ${city}, ${state} ${zip}`.trim() : null,
      needs_location_verification: !lat || !lng || locationBorough === 'Unknown',
      notes: data.notes || data.description || undefined,
    };
  } catch (error) {
    console.error('Failed to fetch client from CRM:', error);
    return null;
  }
}
