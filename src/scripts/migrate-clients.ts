/**
 * Client Migration Script
 * 
 * Migrates clients from CSV to the Scheduling database.
 * Geocodes addresses and stores with precision metadata.
 * 
 * Usage: npx ts-node src/scripts/migrate-clients.ts
 */

import * as path from 'path';
import { loadClientsFromCsv, insertClient, type Client } from '../lib/clients';
import { supabaseSched, isSchedulingDBConfigured, validateSchedulingDB } from '../lib/supabaseSched';
import { normalizeAddress } from '../lib/geocoding/normalize';
import { geocodeWithRetry, isGeocodeError, type GeocodeResult } from '../lib/geocoding/geocode';

async function main() {
  console.log('🚀 Client Migration Script\n');
  console.log('='.repeat(60));
  
  // Validate database connection
  if (!isSchedulingDBConfigured()) {
    console.error('❌ Scheduling database not configured!');
    console.error('   Set SUPABASE_SCHED_* environment variables first.');
    process.exit(1);
  }
  
  console.log('🔒 Validating database connection...');
  await validateSchedulingDB();
  
  // Check if clients table exists
  const { error: tableError } = await supabaseSched
    .from('clients')
    .select('id')
    .limit(1);
  
  if (tableError && tableError.code === '42P01') {
    console.error('❌ clients table does not exist!');
    console.error('   Run the SQL schema setup first:');
    console.error('   sql/001_scheduling_schema.sql');
    process.exit(1);
  }
  
  // Load clients from CSV
  console.log('\n📂 Loading clients from CSV...');
  const csvPath = path.join(__dirname, '..', '..', 'Clients - Sheet1.csv');
  const clients = await loadClientsFromCsv(csvPath);
  
  if (clients.length === 0) {
    console.error('❌ No clients found in CSV');
    process.exit(1);
  }
  
  console.log(`   Found ${clients.length} clients in CSV\n`);
  
  // Check for existing clients
  const { data: existingClients } = await supabaseSched
    .from('clients')
    .select('name');
  
  const existingNames = new Set((existingClients || []).map(c => c.name.toLowerCase()));
  
  if (existingNames.size > 0) {
    console.log(`⚠️  ${existingNames.size} clients already in database`);
    console.log('   Will skip duplicates based on name\n');
  }
  
  // Process each client
  console.log('📍 Geocoding and migrating clients...\n');
  
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  let geocoded = 0;
  let geocodeFailed = 0;
  
  for (let i = 0; i < clients.length; i++) {
    const client = clients[i];
    const progress = `[${i + 1}/${clients.length}]`;
    
    // Skip if already exists
    if (existingNames.has(client.name.toLowerCase())) {
      console.log(`${progress} ⏭️  Skipping ${client.name} (already exists)`);
      skipped++;
      continue;
    }
    
    // Build address for geocoding
    const addressParts = [
      client.address_line,
      client.city,
      client.state,
      client.zip
    ].filter(Boolean);
    const addressString = addressParts.join(', ');
    
    // Normalize and geocode
    const normalized = normalizeAddress(addressString);
    
    let geocodeResult: GeocodeResult | null = null;
    
    if (normalized.geocodeString && !client.needsLocationInfo) {
      process.stdout.write(`${progress} 📍 Geocoding ${client.name}... `);
      
      const result = await geocodeWithRetry(normalized.geocodeString, 3);
      
      if (!isGeocodeError(result)) {
        geocodeResult = result;
        console.log(`✅ ${result.precision} (${(result.confidence * 100).toFixed(0)}%)`);
        geocoded++;
      } else {
        console.log(`⚠️  ${result.message}`);
        geocodeFailed++;
      }
    } else {
      console.log(`${progress} ⚠️  ${client.name} - no address to geocode`);
    }
    
    // Prepare client data
    const clientData: Client = {
      ...client,
      lat: geocodeResult?.lat || null,
      lng: geocodeResult?.lng || null,
      geocode_precision: geocodeResult?.precision || null,
      geocode_confidence: geocodeResult?.confidence || null,
      geocode_source: geocodeResult?.source || 'csv_import',
      geocode_address_used: geocodeResult?.addressUsed || null,
      geocode_updated_at: geocodeResult ? new Date().toISOString() : null,
      needs_location_verification: geocodeResult?.needsVerification || client.needsLocationInfo || false,
    };
    
    // Insert into database
    const insertedId = await insertClient(clientData);
    
    if (insertedId) {
      migrated++;
    } else {
      console.log(`   ❌ Failed to insert ${client.name}`);
      failed++;
    }
    
    // Rate limiting - small delay between geocoding calls
    if (geocodeResult) {
      await sleep(100);
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total in CSV:        ${clients.length}`);
  console.log(`Migrated:            ${migrated}`);
  console.log(`Skipped (existing):  ${skipped}`);
  console.log(`Failed:              ${failed}`);
  console.log(`Geocoded:            ${geocoded}`);
  console.log(`Geocode failed:      ${geocodeFailed}`);
  console.log();
  
  if (geocodeFailed > 0) {
    console.log('⚠️  Some clients could not be geocoded.');
    console.log('   They can be manually verified in the UI.');
  }
  
  if (migrated > 0) {
    console.log('✅ Migration complete!');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run
main().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});

