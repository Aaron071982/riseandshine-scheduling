/**
 * Sync and Geocode RBTs from HRM
 * 
 * Fetches RBTs from HRM database, geocodes their addresses,
 * and inserts/updates them in the Scheduling database with coordinates.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { validateSchedulingDB, isSchedulingDBConfigured, getSchedulingClient } from '../lib/supabaseSched';
import { supabaseServer } from '../lib/supabaseServer';
import { normalizeAddress } from '../lib/geocoding/normalize';
import { geocodeWithPrecision, type GeocodeResult } from '../lib/geocoding/geocode';
import { randomUUID } from 'crypto';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function syncAndGeocodeRBTs() {
  console.log('🚀 Sync and Geocode RBTs from HRM\n');
  console.log('='.repeat(80));
  
  // Validate scheduling database
  if (!isSchedulingDBConfigured()) {
    console.error('❌ Scheduling database not configured!');
    process.exit(1);
  }
  
  await validateSchedulingDB();
  console.log('✅ Scheduling database validated\n');
  
  const supabaseSched = getSchedulingClient();
  
  // Fetch RBTs from HRM - only HIRED ones
  console.log('📂 Fetching HIRED RBTs from HRM database...');
  
  let { data: hrmRbts, error: hrmError } = await supabaseServer
    .from('rbt_profiles')
    .select('id, firstName, lastName, phoneNumber, email, locationCity, locationState, zipCode, addressLine1, addressLine2, status')
    .eq('status', 'hired') // Only hired RBTs
    .limit(200);
  
  // If columns don't exist, try without optional fields
  if (hrmError && hrmError.code === '42703') {
    console.log('⚠️  Some columns not found, trying with basic fields...');
    const retry = await supabaseServer
      .from('rbt_profiles')
      .select('id, firstName, lastName, locationCity, locationState, zipCode, addressLine1, status');
    hrmRbts = retry.data as any;
    hrmError = retry.error;
  }
  
  if (hrmError) {
    console.error('❌ Error fetching RBTs from HRM:', hrmError.message);
    process.exit(1);
  }
  
  if (!hrmRbts || hrmRbts.length === 0) {
    console.log('⚠️  No RBTs found in HRM database');
    return;
  }
  
  console.log(`✅ Found ${hrmRbts.length} RBTs in HRM\n`);
  
  // Process each RBT
  let synced = 0;
  let geocoded = 0;
  let skipped = 0;
  let failed = 0;
  
  for (let i = 0; i < hrmRbts.length; i++) {
    const hrmRbt = hrmRbts[i];
    const fullName = [hrmRbt.firstName, hrmRbt.lastName].filter(Boolean).join(' ').trim() || 'Unknown';
    const progress = `[${i + 1}/${hrmRbts.length}]`;
    
    // Build address
    const addressParts = [
      hrmRbt.addressLine1,
      hrmRbt.addressLine2,
      hrmRbt.locationCity,
      hrmRbt.locationState,
      hrmRbt.zipCode
    ].filter(Boolean);
    
    if (addressParts.length === 0) {
      console.log(`${progress} ⏭️  ${fullName} - no address, skipping`);
      skipped++;
      continue;
    }
    
    const addressString = addressParts.join(', ');
    
    // Check if RBT already exists in scheduling DB (by email or name)
    // Try email first, then fall back to name matching
    let existing = null;
    if (hrmRbt.email) {
      const { data } = await supabaseSched
        .from('rbt_profiles')
        .select('id, lat, lng')
        .eq('email', hrmRbt.email)
        .single();
      existing = data;
    }
    
    // If not found by email, try by name
    if (!existing && fullName !== 'Unknown') {
      const { data } = await supabaseSched
        .from('rbt_profiles')
        .select('id, lat, lng')
        .eq('first_name', hrmRbt.firstName || '')
        .eq('last_name', hrmRbt.lastName || '')
        .single();
      existing = data;
    }
    
    // If exists and has coordinates, skip
    if (existing && existing.lat && existing.lng) {
      console.log(`${progress} ✓ ${fullName} - already has coordinates`);
      synced++;
      continue;
    }
    
    // Generate UUID for scheduling DB (HRM uses CUIDs, not UUIDs)
    const rbtId = existing?.id || randomUUID();
    
    // Geocode address
    process.stdout.write(`${progress} 📍 ${fullName}... `);
    
    try {
      const geocodeResult = await geocodeWithPrecision(addressString);
      
      if ('error' in geocodeResult) {
        console.log(`❌ ${geocodeResult.message}`);
        failed++;
        continue;
      }
      
      const geo: GeocodeResult = geocodeResult;
      
      // Determine if active
      const inactiveStatuses = ['terminated', 'inactive', 'fired', 'resigned'];
      const isActive = !inactiveStatuses.includes((hrmRbt.status || '').toLowerCase());
      
      // Insert or update in scheduling database
      // Note: full_name is a GENERATED column, so we don't include it
      const rbtData = {
        id: rbtId,
        first_name: hrmRbt.firstName || null,
        last_name: hrmRbt.lastName || null,
        // full_name is GENERATED, so we don't set it
        email: hrmRbt.email || null,
        phone: hrmRbt.phoneNumber || null,
        address_line1: hrmRbt.addressLine1 || null,
        address_line2: hrmRbt.addressLine2 || null,
        city: hrmRbt.locationCity || null,
        state: hrmRbt.locationState || null,
        zip_code: hrmRbt.zipCode || null,
        lat: geo.lat,
        lng: geo.lng,
        geocode_precision: geo.precision,
        geocode_confidence: geo.confidence,
        geocode_source: 'hrm_import',
        geocode_updated_at: new Date().toISOString(),
        geocode_address_used: geo.addressUsed,
        is_active: isActive,
        status: hrmRbt.status || 'active',
        // hrm_id: hrmRbt.id, // Skipping for now - column is UUID type but HRM uses CUIDs
        // TODO: Run migration 007_fix_hrm_id_type.sql to change hrm_id to TEXT
      };
      
      let upsertError;
      if (existing) {
        // Update existing
        const { error } = await supabaseSched
          .from('rbt_profiles')
          .update(rbtData)
          .eq('id', existing.id);
        upsertError = error;
      } else {
        // Insert new
        const { error } = await supabaseSched
          .from('rbt_profiles')
          .insert(rbtData);
        upsertError = error;
      }
      
      if (upsertError) {
        console.log(`❌ Database error: ${upsertError.message}`);
        failed++;
        continue;
      }
      
      console.log(`✅ ${geo.precision} (${(geo.confidence * 100).toFixed(0)}%)`);
      synced++;
      geocoded++;
      
      // Rate limiting - wait a bit between geocoding requests
      if (i < hrmRbts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error) {
      console.log(`❌ ${error instanceof Error ? error.message : 'Unknown error'}`);
      failed++;
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('✅ Sync and Geocode Complete!');
  console.log(`   Synced: ${synced}`);
  console.log(`   Geocoded: ${geocoded}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Failed: ${failed}`);
  console.log('='.repeat(80));
}

// Run
syncAndGeocodeRBTs().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
