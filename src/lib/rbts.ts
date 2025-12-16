import { supabaseServer } from './supabaseServer';

export type RBT = {
  id: string;
  full_name: string;
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
  onboardingComplete?: boolean;
  onboardingDocuments?: string[];
  fortyHourCourseComplete?: boolean;
  fortyHourCourseLink?: string | null;
};

/**
 * Fetches all active RBTs from Supabase
 */
export async function getActiveRBTs(): Promise<RBT[]> {
  try {
    // Fetch RBTs using the correct column names from the schema
    // Try with optional 40-hour course fields first, fallback if they don't exist
    let { data, error } = await supabaseServer
      .from('rbt_profiles')
      .select('id, firstName, lastName, phoneNumber, email, locationCity, locationState, zipCode, addressLine1, addressLine2, status, fortyHourCourseCompleted, fortyHourCourseLink');

    // If columns don't exist, try without them
    if (error && error.code === '42703') {
      console.log('⚠️  40-hour course columns not found, fetching without them...');
      const retry = await supabaseServer
        .from('rbt_profiles')
        .select('id, firstName, lastName, phoneNumber, email, locationCity, locationState, zipCode, addressLine1, addressLine2, status');
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      console.error('Error fetching RBTs from Supabase:', error);
      return [];
    }

    if (!data || data.length === 0) {
      console.log('⚠️ No RBT data returned from Supabase');
      return [];
    }

    console.log(`\n📋 Fetched ${data.length} RBTs from Supabase`);
    if (data.length > 0) {
      console.log('   Sample row columns:', Object.keys(data[0]));
    }

    // Log status values to see what we're working with
    const statusCounts: Record<string, number> = {};
    data.forEach((row: any) => {
      statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
    });
    console.log('   Status distribution:', statusCounts);

    // Map the data to our RBT type using the actual schema column names
    const mapped = data.map((row: any) => {
      // Combine firstName and lastName
      const fullName = [row.firstName, row.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || row.email?.split('@')[0] || `RBT-${row.id?.substring(0, 8) || 'Unknown'}`;
      
      // Combine addressLine1 and addressLine2
      const addressLine = [row.addressLine1, row.addressLine2]
        .filter(Boolean)
        .join(', ')
        .trim() || null;
      
      // Determine if active - include most statuses except explicitly inactive ones
      const inactiveStatuses = ['terminated', 'inactive', 'fired', 'resigned'];
      const isActive = !inactiveStatuses.includes((row.status || '').toLowerCase());
      
          // Map transport mode from database or default to 'Both'
          let transportMode: 'Car' | 'Transit' | 'Both' = 'Both';
          if (row.transportMode || row.transport_mode) {
            const mode = (row.transportMode || row.transport_mode || '').toString().toLowerCase();
            if (mode.includes('car') && mode.includes('transit') || mode.includes('both') || mode.includes('hybrid')) {
              transportMode = 'Both';
            } else if (mode.includes('transit') || mode.includes('public')) {
              transportMode = 'Transit';
            } else if (mode.includes('car') || mode.includes('driving')) {
              transportMode = 'Car';
            }
          }
          
          return {
            id: row.id,
            full_name: fullName,
            address_line: addressLine,
            city: row.locationCity || null,
            state: row.locationState || null,
            zip: row.zipCode || null,
            lat: null, // Not in schema - will need to geocode
            lng: null, // Not in schema - will need to geocode
            is_active: isActive,
            transport_mode: transportMode,
            gender: null as 'Male' | 'Female' | null, // Will be set via UI/admin panel
            travelMode: (transportMode === 'Both' ? 'HYBRID' : transportMode === 'Transit' ? 'TRANSIT' : 'DRIVING') as 'DRIVING' | 'TRANSIT' | 'HYBRID',
            email: row.email || null,
            phone: row.phoneNumber || null,
            onboardingComplete: false, // Will be set when documents are uploaded
            onboardingDocuments: [],
            // Try to get 40-hour course fields if they exist (may not be in all schemas)
            fortyHourCourseComplete: (row.fortyHourCourseCompleted !== undefined) ? row.fortyHourCourseCompleted : false,
            fortyHourCourseLink: row.fortyHourCourseLink || null
          };
    });

    // Filter to only active RBTs
    const activeRBTs = mapped.filter(rbt => rbt.is_active === true);

    console.log(`\n✅ Mapped ${activeRBTs.length} active RBTs:`);
    activeRBTs.slice(0, 5).forEach(rbt => {
      const location = [rbt.city, rbt.state, rbt.zip].filter(Boolean).join(', ') || 'No location';
      console.log(`   - ${rbt.full_name}: ${location}`);
    });

    return activeRBTs;
  } catch (error) {
    console.error('Failed to fetch RBTs from Supabase:', error);
    return [];
  }
}

/**
 * Gets a single RBT by ID
 */
export async function getRBTById(id: string): Promise<RBT | null> {
  try {
    const { data, error } = await supabaseServer
      .from('rbt_profiles')
      .select('id, full_name, address_line, city, state, zip, lat, lng, is_active, transport_mode, email, phone')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching RBT:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Failed to fetch RBT:', error);
    return null;
  }
}

