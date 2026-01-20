/**
 * RBT Geocoding Script
 * 
 * Batch geocodes RBT addresses and updates the Scheduling database.
 * 
 * Usage: npx ts-node src/scripts/geocode-rbts.ts
 */

import { supabaseSched, isSchedulingDBConfigured, validateSchedulingDB } from '../lib/supabaseSched';
import { normalizeAddress } from '../lib/geocoding/normalize';
import { geocodeWithRetry, isGeocodeError, type GeocodeResult } from '../lib/geocoding/geocode';
import { updateRBTGeocoding } from '../lib/rbts';

interface RBTRecord {
  id: string;
  first_name: string;
  last_name: string;
  full_name?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  lat?: number;
  lng?: number;
  geocode_precision?: string;
}

async function main() {
  console.log('🚀 RBT Geocoding Script\n');
  console.log('='.repeat(60));
  
  // Validate database connection
  if (!isSchedulingDBConfigured()) {
    console.error('❌ Scheduling database not configured!');
    console.error('   Set SUPABASE_SCHED_* environment variables first.');
    process.exit(1);
  }
  
  console.log('🔒 Validating database connection...');
  await validateSchedulingDB();
  
  // Fetch RBTs that need geocoding
  console.log('\n📂 Fetching RBTs from database...');
  
  const { data: rbts, error } = await supabaseSched
    .from('rbt_profiles')
    .select('id, first_name, last_name, full_name, address_line1, address_line2, city, state, zip_code, lat, lng, geocode_precision')
    .is('lat', null);
  
  if (error) {
    if (error.code === '42P01') {
      console.error('❌ rbt_profiles table does not exist!');
      console.error('   Run the SQL schema setup first.');
      process.exit(1);
    }
    console.error('Error fetching RBTs:', error);
    process.exit(1);
  }
  
  if (!rbts || rbts.length === 0) {
    console.log('✅ All RBTs already have coordinates!');
    
    // Show stats
    const { data: allRbts } = await supabaseSched
      .from('rbt_profiles')
      .select('geocode_precision');
    
    if (allRbts) {
      const precisionCounts: Record<string, number> = {};
      allRbts.forEach(r => {
        const p = r.geocode_precision || 'none';
        precisionCounts[p] = (precisionCounts[p] || 0) + 1;
      });
      console.log('\nPrecision distribution:');
      Object.entries(precisionCounts).forEach(([p, c]) => {
        console.log(`   ${p}: ${c}`);
      });
    }
    return;
  }
  
  console.log(`   Found ${rbts.length} RBTs needing geocoding\n`);
  
  // Process each RBT
  console.log('📍 Geocoding RBTs...\n');
  
  let geocoded = 0;
  let failed = 0;
  let skipped = 0;
  
  for (let i = 0; i < rbts.length; i++) {
    const rbt = rbts[i] as RBTRecord;
    const name = rbt.full_name || `${rbt.first_name} ${rbt.last_name}`.trim();
    const progress = `[${i + 1}/${rbts.length}]`;
    
    // Build address
    const addressParts = [
      rbt.address_line1,
      rbt.address_line2,
      rbt.city,
      rbt.state,
      rbt.zip_code
    ].filter(Boolean);
    
    if (addressParts.length === 0) {
      console.log(`${progress} ⏭️  ${name} - no address available`);
      skipped++;
      continue;
    }
    
    const addressString = addressParts.join(', ');
    const normalized = normalizeAddress(addressString);
    
    if (!normalized.geocodeString) {
      console.log(`${progress} ⏭️  ${name} - could not normalize address`);
      skipped++;
      continue;
    }
    
    process.stdout.write(`${progress} 📍 ${name}... `);
    
    const result = await geocodeWithRetry(normalized.geocodeString, 3);
    
    if (isGeocodeError(result)) {
      console.log(`❌ ${result.message}`);
      failed++;
      continue;
    }
    
    // Update database
    const updated = await updateRBTGeocoding(
      rbt.id,
      result.lat,
      result.lng,
      result.precision,
      result.confidence,
      result.source,
      result.addressUsed
    );
    
    if (updated) {
      console.log(`✅ ${result.precision} (${(result.confidence * 100).toFixed(0)}%)`);
      geocoded++;
    } else {
      console.log(`⚠️  Geocoded but failed to save`);
      failed++;
    }
    
    // Rate limiting
    await sleep(100);
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('GEOCODING SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total RBTs processed: ${rbts.length}`);
  console.log(`Geocoded:             ${geocoded}`);
  console.log(`Skipped (no address): ${skipped}`);
  console.log(`Failed:               ${failed}`);
  console.log();
  
  // Show updated precision distribution
  const { data: allRbts } = await supabaseSched
    .from('rbt_profiles')
    .select('geocode_precision, lat');
  
  if (allRbts) {
    const withCoords = allRbts.filter(r => r.lat !== null).length;
    const withoutCoords = allRbts.length - withCoords;
    
    console.log(`\nRBTs with coordinates:    ${withCoords}/${allRbts.length}`);
    console.log(`RBTs without coordinates: ${withoutCoords}`);
    
    const precisionCounts: Record<string, number> = {};
    allRbts.forEach(r => {
      const p = r.geocode_precision || 'none';
      precisionCounts[p] = (precisionCounts[p] || 0) + 1;
    });
    
    console.log('\nPrecision distribution:');
    Object.entries(precisionCounts).forEach(([p, c]) => {
      console.log(`   ${p}: ${c}`);
    });
  }
  
  if (geocoded > 0) {
    console.log('\n✅ Geocoding complete!');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run
main().catch(error => {
  console.error('Geocoding failed:', error);
  process.exit(1);
});

