/**
 * RBT Data Access Layer
 * 
 * This module handles fetching RBT data from the Scheduling database.
 * It uses the isolated scheduling Supabase client to prevent HRM contamination.
 */

import { supabaseSched, isSchedulingDBConfigured } from './supabaseSched';
import { mapRbtRowToRbt } from './mappers/entities';

// Geocoding precision types
export type GeocodePrecision = 'ROOFTOP' | 'RANGE_INTERPOLATED' | 'GEOMETRIC_CENTER' | 'APPROXIMATE';
export type GeocodeSource = 'full_address' | 'zip_only' | 'city_state' | 'manual_pin' | 'hrm_import' | 'csv_import' | 'crm_import';

export type RBT = {
  id: string;
  full_name: string;
  first_name?: string;
  last_name?: string;
  address_line: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  is_active?: boolean;
  transport_mode: 'Car' | 'Transit' | 'Both';
  gender?: 'Male' | 'Female' | null;
  travelMode?: 'DRIVING' | 'TRANSIT' | 'HYBRID';
  email?: string | null;
  phone?: string | null;
  fortyHourCourseComplete?: boolean;
  fortyHourCourseLink?: string | null;
  // Geocoding metadata
  geocode_precision?: GeocodePrecision | null;
  geocode_confidence?: number | null;
  geocode_source?: GeocodeSource | null;
  geocode_updated_at?: string | null;
  geocode_address_used?: string | null;
  // HRM sync
  hrm_id?: string | null;
};

/**
 * Fetches all active RBTs from the Scheduling database
 */
export async function getActiveRBTs(): Promise<RBT[]> {
  if (!isSchedulingDBConfigured()) {
    console.warn('⚠️ Scheduling DB not configured - returning empty RBT list');
    console.warn('   Set SUPABASE_SCHED_* environment variables to enable');
    return [];
  }

  try {
    // Try to fetch from scheduling DB with full schema
    const { data, error } = await supabaseSched
      .from('rbt_profiles')
      .select(`
        id, first_name, last_name, full_name, email, phone,
        address_line1, address_line2, city, state, zip_code,
        lat, lng, geocode_precision, geocode_confidence, geocode_source, geocode_updated_at, geocode_address_used,
        status, is_active, transport_mode, gender,
        forty_hour_course_completed, forty_hour_course_link,
        hrm_id
      `);

    if (error) {
      // If table doesn't exist in scheduling DB, try legacy HRM format
      if (error.code === '42P01' || error.message.includes('does not exist')) {
        console.warn('⚠️ rbt_profiles table not found in scheduling DB');
        console.warn('   Run the SQL schema setup first, then sync data from HRM');
        return await getActiveRBTsFromHRM();
      }
      console.error('Error fetching RBTs from Scheduling DB:', error);
      return [];
    }

    if (!data || data.length === 0) {
      console.log('⚠️ No RBT data in Scheduling DB - trying HRM fallback');
      return await getActiveRBTsFromHRM();
    }

    console.log(`\n📋 Fetched ${data.length} RBTs from Scheduling DB`);

    // Map to RBT type using mapper
    const mapped: RBT[] = data.map((row: any) => mapRbtRowToRbt(row));

    // Filter to active only
    let activeRBTs = mapped.filter(rbt => rbt.is_active === true);

    // Filter out RBTs without zip codes (required for accurate matching)
    const beforeZipFilter = activeRBTs.length;
    activeRBTs = activeRBTs.filter(rbt => {
      const hasZip = rbt.zip && rbt.zip.trim() !== '';
      if (!hasZip) {
        console.warn(`   ⚠️  Excluding RBT ${rbt.full_name} - missing zip code`);
      }
      return hasZip;
    });

    if (beforeZipFilter > activeRBTs.length) {
      console.log(`   ⚠️  Excluded ${beforeZipFilter - activeRBTs.length} RBTs without zip codes`);
    }

    console.log(`✅ Mapped ${activeRBTs.length} active RBTs (with zip codes)`);
    logRBTSummary(activeRBTs);

    return activeRBTs;
  } catch (error) {
    console.error('Failed to fetch RBTs:', error);
    return [];
  }
}

/**
 * Fallback: Fetch RBTs from HRM database (read-only)
 * This is used when the scheduling DB doesn't have RBT data yet
 */
async function getActiveRBTsFromHRM(): Promise<RBT[]> {
  // Import the old HRM client if it exists
  try {
    const { supabaseServer } = await import('./supabaseServer');
    
    console.log('📂 Falling back to HRM database for RBT data...');
    
    // Try with optional fields first - only get HIRED RBTs
    let query = supabaseServer
      .from('rbt_profiles')
      .select('id, firstName, lastName, phoneNumber, email, locationCity, locationState, zipCode, addressLine1, addressLine2, status, fortyHourCourseCompleted, fortyHourCourseLink')
      .eq('status', 'hired'); // Only hired RBTs from HRM
    
    let { data, error } = await query;

      // If columns don't exist, try without them
      if (error && error.code === '42703') {
        console.log('⚠️ 40-hour course columns not found, fetching without them...');
        const retry = await supabaseServer
          .from('rbt_profiles')
          .select('id, firstName, lastName, phoneNumber, email, locationCity, locationState, zipCode, addressLine1, addressLine2, status')
          .eq('status', 'hired'); // Only hired RBTs
        data = retry.data as any;
        error = retry.error;
      }

    if (error) {
      console.error('Error fetching RBTs from HRM:', error);
      return [];
    }

    if (!data || data.length === 0) {
      console.log('⚠️ No RBT data returned from HRM');
      return [];
    }

    console.log(`\n📋 Fetched ${data.length} RBTs from HRM (read-only)`);
    if (data.length > 0) {
      console.log('   Sample row columns:', Object.keys(data[0]));
    }

    // Log status distribution
    const statusCounts: Record<string, number> = {};
    data.forEach((row: any) => {
      statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
    });
    console.log('   Status distribution:', statusCounts);

    // Map HRM format to our RBT type
    const mapped: RBT[] = data.map((row: any) => {
      const fullName = [row.firstName, row.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || row.email?.split('@')[0] || `RBT-${row.id?.substring(0, 8) || 'Unknown'}`;
      
      const addressLine = [row.addressLine1, row.addressLine2]
        .filter(Boolean)
        .join(', ')
        .trim() || null;
      
      const inactiveStatuses = ['terminated', 'inactive', 'fired', 'resigned'];
      const isActive = !inactiveStatuses.includes((row.status || '').toLowerCase());
      
      // Normalize transport mode for HRM data
      const normalizeTransportMode = (mode: string | null | undefined): 'Car' | 'Transit' | 'Both' => {
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
      };
      const transportMode = normalizeTransportMode(row.transportMode || row.transport_mode);
      
      return {
        id: row.id,
        full_name: fullName,
        first_name: row.firstName,
        last_name: row.lastName,
        address_line: addressLine,
        city: row.locationCity || null,
        state: row.locationState || null,
        zip: row.zipCode || null,
        lat: null, // HRM doesn't have geocoding
        lng: null,
        is_active: isActive,
        transport_mode: transportMode,
        gender: null,
        travelMode: transportMode === 'Both' ? 'HYBRID' : transportMode === 'Transit' ? 'TRANSIT' : 'DRIVING',
        email: row.email || null,
        phone: row.phoneNumber || null,
        fortyHourCourseComplete: row.fortyHourCourseCompleted || false,
        fortyHourCourseLink: row.fortyHourCourseLink || null,
        // No geocoding metadata from HRM
        geocode_precision: null,
        geocode_confidence: null,
        geocode_source: 'hrm_import',
        geocode_updated_at: null,
        geocode_address_used: null,
        hrm_id: row.id, // Store original HRM ID
      };
    });

    let activeRBTs = mapped.filter(rbt => rbt.is_active === true);

    // Filter out RBTs without zip codes (required for accurate matching)
    const beforeZipFilter = activeRBTs.length;
    activeRBTs = activeRBTs.filter(rbt => {
      const hasZip = rbt.zip && rbt.zip.trim() !== '';
      if (!hasZip) {
        console.warn(`   ⚠️  Excluding RBT ${rbt.full_name} - missing zip code`);
      }
      return hasZip;
    });

    if (beforeZipFilter > activeRBTs.length) {
      console.log(`   ⚠️  Excluded ${beforeZipFilter - activeRBTs.length} RBTs without zip codes`);
    }

    console.log(`\n✅ Mapped ${activeRBTs.length} active RBTs from HRM (with zip codes):`);
    logRBTSummary(activeRBTs);

    return activeRBTs;
  } catch (error) {
    console.error('Failed to fetch RBTs from HRM:', error);
    return [];
  }
}

/**
 * Gets a single RBT by ID from the Scheduling database
 */
export async function getRBTById(id: string): Promise<RBT | null> {
  if (!isSchedulingDBConfigured()) {
    return null;
  }

  try {
    const { data, error } = await supabaseSched
      .from('rbt_profiles')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching RBT:', error);
      return null;
    }

    return data ? mapRbtRowToRbt(data) : null;
  } catch (error) {
    console.error('Failed to fetch RBT:', error);
    return null;
  }
}

/**
 * Updates RBT geocoding data in the Scheduling database
 * Also invalidates travel time cache for this RBT
 */
export async function updateRBTGeocoding(
  id: string,
  lat: number,
  lng: number,
  precision: GeocodePrecision,
  confidence: number,
  source: GeocodeSource,
  addressUsed: string
): Promise<boolean> {
  if (!isSchedulingDBConfigured()) {
    console.warn('Cannot update RBT geocoding - Scheduling DB not configured');
    return false;
  }

  try {
    // Get old coordinates to check if they changed
    const { data: oldRbt } = await supabaseSched
      .from('rbt_profiles')
      .select('lat, lng')
      .eq('id', id)
      .single();

    const oldLat = oldRbt?.lat ? parseFloat(oldRbt.lat.toString()) : null;
    const oldLng = oldRbt?.lng ? parseFloat(oldRbt.lng.toString()) : null;
    const coordsChanged = oldLat !== lat || oldLng !== lng;

    const { error } = await supabaseSched
      .from('rbt_profiles')
      .update({
        lat,
        lng,
        geocode_precision: precision,
        geocode_confidence: confidence,
        geocode_source: source,
        geocode_address_used: addressUsed,
        geocode_updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      console.error('Error updating RBT geocoding:', error);
      return false;
    }

    // Invalidate cache if coordinates changed
    if (coordsChanged) {
      const { invalidateCacheForEntity } = await import('./scheduling/travelTimeCache');
      await invalidateCacheForEntity('rbt', id);
      console.log(`   Invalidated travel time cache for RBT ${id.substring(0, 8)}...`);
    }

    return true;
  } catch (error) {
    console.error('Failed to update RBT geocoding:', error);
    return false;
  }
}


/**
 * Logs RBT summary for debugging
 */
function logRBTSummary(rbts: RBT[]): void {
  rbts.slice(0, 5).forEach(rbt => {
    const location = [rbt.city, rbt.state, rbt.zip].filter(Boolean).join(', ') || 'No location';
    const hasCoords = rbt.lat && rbt.lng;
    const precision = rbt.geocode_precision || 'none';
    console.log(`   - ${rbt.full_name}: ${location} ${hasCoords ? `[${precision}]` : '[no coords]'}`);
  });
  if (rbts.length > 5) {
    console.log(`   ... and ${rbts.length - 5} more`);
  }
}