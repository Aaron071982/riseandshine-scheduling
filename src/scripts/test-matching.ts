/**
 * Test Matching Script
 * 
 * Dry-run test for the matching algorithm without writing to database.
 * Validates cache behavior and matching logic.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { validateSchedulingDB, isSchedulingDBConfigured } from '../lib/supabaseSched';
import { getActiveRBTs } from '../lib/rbts';
import { loadClients } from '../lib/clients';
import { matchClientsToRBTs } from '../lib/scheduling/matcher';
import { getCachedTravelTime, clearExpiredCache } from '../lib/scheduling/travelTimeCache';
import { config } from '../lib/config';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function testMatching() {
  console.log('🧪 Starting Matching Test (Dry Run)\n');
  console.log('='.repeat(80));
  
  // Validate configuration
  if (!isSchedulingDBConfigured()) {
    console.error('❌ FATAL: Scheduling DB not configured. Set SUPABASE_SCHED_* environment variables.');
    process.exit(1);
  }
  
  try {
    await validateSchedulingDB();
    console.log('✅ Database validated\n');
  } catch (error: any) {
    console.error('❌ Database validation failed:', error.message);
    process.exit(1);
  }
  
  // Display configuration
  console.log('📋 Configuration:');
  console.log(`   Peak Bucket: ${config.peakBucketName}`);
  console.log(`   Sample Times: ${config.peakSampleTimes.join(', ')}`);
  console.log(`   Traffic Model: ${config.trafficModel}`);
  console.log(`   Max Travel Time: ${config.matchMaxTravelMinutes} minutes`);
  console.log(`   Travel Time TTL: ${config.travelTimeTtlDays} days\n`);
  
  // Load data
  console.log('📥 Loading data...');
  const rbts = await getActiveRBTs();
  const clients = await loadClients();
  
  console.log(`   ✅ Loaded ${rbts.length} RBTs`);
  console.log(`   ✅ Loaded ${clients.length} clients\n`);
  
  if (rbts.length === 0 || clients.length === 0) {
    console.warn('⚠️  Insufficient data for testing');
    return;
  }
  
  // Clear expired cache entries
  console.log('🧹 Cleaning expired cache entries...');
  const cleared = await clearExpiredCache();
  console.log(`   ✅ Cleared ${cleared} expired entries\n`);
  
  // Test cache behavior
  console.log('🔍 Testing cache behavior...');
  if (rbts.length > 0 && clients.length > 0) {
    const testRbt = rbts.find(r => r.lat && r.lng);
    const testClient = clients.find(c => c.lat && c.lng);
    
    if (testRbt && testClient) {
      console.log(`   Testing: ${testRbt.full_name} → ${testClient.name}`);
      
      // First call (should hit Google API)
      console.log('   Call 1: Computing travel time...');
      const start1 = Date.now();
      const result1 = await getCachedTravelTime({
        originLat: testRbt.lat!,
        originLng: testRbt.lng!,
        destLat: testClient.lat!,
        destLng: testClient.lng!,
        mode: 'driving',
        originId: testRbt.id,
        originType: 'rbt',
        destId: testClient.id,
        destType: 'client',
      });
      const duration1 = Date.now() - start1;
      
      if (result1) {
        console.log(`   ✅ Result: ${Math.round(result1.durationSec / 60)} min (${result1.distanceMeters ? Math.round(result1.distanceMeters / 1609.34 * 10) / 10 : '?'} miles)`);
        console.log(`   Source: ${result1.fromCache ? 'Cache' : 'Google API'} (${duration1}ms)`);
        console.log(`   Samples: ${result1.samples.length}`);
        
        // Second call (should hit cache)
        console.log('   Call 2: Retrieving from cache...');
        const start2 = Date.now();
        const result2 = await getCachedTravelTime({
          originLat: testRbt.lat!,
          originLng: testRbt.lng!,
          destLat: testClient.lat!,
          destLng: testClient.lng!,
          mode: 'driving',
          originId: testRbt.id,
          originType: 'rbt',
          destId: testClient.id,
          destType: 'client',
        });
        const duration2 = Date.now() - start2;
        
        if (result2 && result2.fromCache) {
          console.log(`   ✅ Cache hit! (${duration2}ms, ${Math.round((1 - duration2 / duration1) * 100)}% faster)`);
        } else {
          console.warn('   ⚠️  Expected cache hit but got fresh result');
        }
      } else {
        console.warn('   ⚠️  No travel time result');
      }
    }
  }
  console.log('');
  
  // Run matching algorithm
  console.log('🎯 Running matching algorithm (dry run)...');
  const matchStart = Date.now();
  
  const matches = await matchClientsToRBTs(clients, rbts);
  
  const matchDuration = Math.round((Date.now() - matchStart) / 1000);
  
  // Analyze results
  const matchedCount = matches.filter(m => m.status === 'matched').length;
  const standbyCount = matches.filter(m => m.status === 'standby').length;
  const noLocationCount = matches.filter(m => m.status === 'no_location').length;
  const needsReviewCount = matches.filter(m => m.needsReview).length;
  
  console.log('\n📊 Matching Results:');
  console.log('='.repeat(80));
  console.log(`   ✅ Matched: ${matchedCount}`);
  console.log(`   ⏳ Standby: ${standbyCount}`);
  console.log(`   ⚠️  No Location: ${noLocationCount}`);
  if (needsReviewCount > 0) {
    console.log(`   🔍 Needs Review: ${needsReviewCount}`);
  }
  console.log(`   ⏱️  Duration: ${matchDuration}s`);
  console.log('');
  
  // Show sample matches
  if (matchedCount > 0) {
    console.log('📋 Sample Matches (first 5):');
    console.log('-'.repeat(80));
    matches
      .filter(m => m.status === 'matched')
      .slice(0, 5)
      .forEach(m => {
        console.log(`   ${m.client.name.padEnd(25)} → ${m.rbt?.full_name.padEnd(25)} (${m.travelTimeMinutes} min, ${m.distanceMiles || '?'} mi)`);
        if (m.explain) {
          console.log(`      Mode: ${m.explain.chosenMode}, Bucket: ${m.explain.bucket}`);
          if (m.explain.flags.length > 0) {
            console.log(`      Flags: ${m.explain.flags.join(', ')}`);
          }
        }
      });
    console.log('');
  }
  
  // Show unmatched reasons
  if (standbyCount > 0) {
    const reasons = new Map<string, number>();
    matches
      .filter(m => m.status === 'standby')
      .forEach(m => {
        const reason = m.reason || 'Unknown';
        reasons.set(reason, (reasons.get(reason) || 0) + 1);
      });
    
    console.log('📋 Standby Reasons:');
    reasons.forEach((count, reason) => {
      console.log(`   ${reason}: ${count}`);
    });
    console.log('');
  }
  
  console.log('✅ Test completed successfully!');
  console.log('='.repeat(80));
  
  // Exit with success
  process.exit(0);
}

// Run test
testMatching().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});

