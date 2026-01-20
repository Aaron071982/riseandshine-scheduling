/**
 * Scheduling AI Matching System
 * 
 * Main entry point for the scheduling system.
 * Loads RBTs and clients, runs matching algorithm, outputs results.
 */

import * as path from "path";
import * as fs from "fs";
import { randomUUID } from "crypto";
import { loadClients, loadClientsFromCsv } from "./lib/clients";
import { getActiveRBTs } from "./lib/rbts";
import { matchClientsToRBTs, matchClientsToRBTsWithMetrics } from "./lib/scheduling/matcher";
import { validateSchedulingDB, isSchedulingDBConfigured, getSchedulingDBUrl, getSchedulingClient } from "./lib/supabaseSched";
import { mapMatchToFrontend, mapRbtToFrontend, mapClientToFrontend } from "./lib/mappers/entities";
import { config } from "./lib/config";

async function main() {
  console.log("🚀 Starting Scheduling AI Matching System\n");
  
  // =========================================================================
  // SAFETY CHECK: Validate database connection
  // =========================================================================
  console.log("🔒 Validating database connection...");
  
  if (isSchedulingDBConfigured()) {
    console.log(`   Scheduling DB: ${getSchedulingDBUrl()}`);
    await validateSchedulingDB();
  } else {
    console.log("   ⚠️ Scheduling DB not configured - using CSV/HRM fallback mode");
    console.log("   Set SUPABASE_SCHED_* environment variables for full functionality\n");
  }
  
  // =========================================================================
  // Load RBTs
  // =========================================================================
  console.log("\n📂 Loading RBTs...");
  const rbts = await getActiveRBTs();
  console.log(`   Loaded ${rbts.length} active RBTs\n`);

  if (rbts.length === 0) {
    console.warn("⚠️ No RBTs found. Cannot proceed with matching.");
    console.warn("   Ensure RBT data is available in the database or HRM system.");
    return;
  }

  // Log geocoding status for RBTs
  const rbtsWithCoords = rbts.filter(r => r.lat && r.lng);
  const rbtsNeedingGeocode = rbts.filter(r => !r.lat || !r.lng);
  console.log(`   📍 RBTs with coordinates: ${rbtsWithCoords.length}/${rbts.length}`);
  if (rbtsNeedingGeocode.length > 0) {
    console.log(`   ⚠️ RBTs needing geocoding: ${rbtsNeedingGeocode.length}`);
  }

  // =========================================================================
  // Load Clients
  // =========================================================================
  console.log("\n📂 Loading Clients...");
  const clients = await loadClients();
  console.log(`   Loaded ${clients.length} clients\n`);

  if (clients.length === 0) {
    console.warn("⚠️ No clients found. Cannot proceed with matching.");
    return;
  }

  // Log geocoding status for clients
  const clientsWithCoords = clients.filter(c => c.lat && c.lng);
  const clientsNeedingGeocode = clients.filter(c => !c.lat || !c.lng);
  console.log(`   📍 Clients with coordinates: ${clientsWithCoords.length}/${clients.length}`);
  if (clientsNeedingGeocode.length > 0) {
    console.log(`   ⚠️ Clients needing geocoding: ${clientsNeedingGeocode.length}`);
  }

  // =========================================================================
  // Run Matching Algorithm
  // =========================================================================
  console.log("\n🔍 Running matching algorithm...\n");
  
  const runId = randomUUID();
  const runStartTime = Date.now();
  
  // Run matching with metrics
  const matchingResult = await matchClientsToRBTsWithMetrics(clients, rbts);
  const matches = matchingResult.matches;
  
  const runDurationSec = Math.round((Date.now() - runStartTime) / 1000);
  
  // Calculate summary statistics (used in multiple places)
  const matchedCount = matches.filter(m => m.status === 'matched').length;
  const standbyCount = matches.filter(m => m.status === 'standby').length;
  const noLocationCount = matches.filter(m => m.status === 'no_location').length;
  const needsReviewCount = matches.filter(m => m.needsReview).length;
  
  // Calculate cache hit rate
  const totalRequests = matchingResult.googleApiCalls + matchingResult.cacheHits;
  const cacheHitRate = totalRequests > 0 
    ? Math.round((matchingResult.cacheHits / totalRequests) * 100 * 100) / 100 
    : 0;
  
  // =========================================================================
  // Write Matches to Database
  // =========================================================================
  if (isSchedulingDBConfigured()) {
    console.log("\n💾 Writing matches to database...");
    try {
      const supabase = getSchedulingClient();
      const computedAt = new Date().toISOString();
      
      // Mark all existing active matches as inactive
      const { error: deactivateError } = await supabase
        .from('matches')
        .update({ active: false })
        .eq('active', true);
      
      if (deactivateError) {
        console.warn('⚠️  Warning: Could not deactivate old matches:', deactivateError.message);
      }
      
      // Create match run record
      const matchRunId = randomUUID();
      try {
        await supabase
          .from('match_runs')
          .insert({
            id: matchRunId,
            started_at: new Date(runStartTime).toISOString(),
            input_clients_count: clients.length,
            input_rbts_count: rbts.length,
          });
      } catch (runError: any) {
        console.warn('⚠️  Warning: Could not create match run record:', runError.message);
      }
      
      // Insert new matches (only matched and needs_review)
      const matchesToInsert = matches
        .filter(m => m.status === 'matched' || m.status === 'needs_review')
        .map(m => ({
          client_id: m.client.id,
          rbt_id: m.rbt?.id || null,
          status: m.status,
          travel_time_seconds: m.travelTimeSeconds,
          travel_time_minutes: m.travelTimeMinutes,
          distance_miles: m.distanceMiles,
          travel_mode: m.travelMode || null,
          client_geocode_precision: m.client.geocode_precision || null,
          rbt_geocode_precision: m.rbt?.geocode_precision || null,
          needs_review: m.needsReview || false,
          review_reason: m.reviewReason || null,
          reason: m.reason || null,
          source: m.source || 'AUTO',
          locked: m.locked || false,
          match_run_id: matchRunId,
          computed_at: computedAt,
          active: true,
        }));
      
      if (matchesToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('matches')
          .insert(matchesToInsert);
        
        if (insertError) {
          console.error('❌ Error inserting matches:', insertError.message);
        } else {
          console.log(`   ✅ Inserted ${matchesToInsert.length} matches with run_id: ${runId}`);
        }
      }
      
      // Update match run record with results
      try {
        await supabase
          .from('match_runs')
          .update({
            ended_at: computedAt,
            matched_count: matchedCount,
            locked_count: matchingResult.lockedCount,
            auto_count: matchingResult.autoCount,
            manual_count: matchingResult.manualCount,
            standby_count: standbyCount,
            no_location_count: noLocationCount,
            blocked_count: matchingResult.blockedCount,
            google_api_calls: matchingResult.googleApiCalls,
            cache_hits: matchingResult.cacheHits,
            cache_hit_rate: cacheHitRate,
            metadata: {
              runId,
              needsReviewCount,
            },
          })
          .eq('id', matchRunId);
      } catch (runUpdateError: any) {
        console.warn('⚠️  Warning: Could not update match run record:', runUpdateError.message);
      }
      
      // Build summary for metadata
      const summary = {
        matchedCount,
        standbyCount,
        noLocationCount,
        needsReviewCount,
        durationSec: runDurationSec,
        runId,
        matchRunId,
        googleApiCalls: matchingResult.googleApiCalls,
        cacheHits: matchingResult.cacheHits,
        cacheHitRate,
        lockedCount: matchingResult.lockedCount,
        autoCount: matchingResult.autoCount,
        blockedCount: matchingResult.blockedCount,
      };
      
      // Update scheduling_meta with last run info
      const { error: metaError } = await supabase
        .from('scheduling_meta')
        .update({
          last_matching_run_at: computedAt,
          last_matching_summary: summary,
          updated_at: computedAt,
        })
        .eq('id', 1);
      
      if (metaError) {
        console.warn('⚠️  Warning: Could not update scheduling_meta:', metaError.message);
      } else {
        console.log('   ✅ Updated scheduling_meta with run summary');
      }
    } catch (error) {
      console.error('❌ Error writing to database:', error);
    }
  }
  
  // =========================================================================
  // Display Results
  // =========================================================================
  console.log("\n" + "=".repeat(100));
  console.log("MATCHING RESULTS");
  console.log("=".repeat(100));
  console.log();

  console.log(
    "Client".padEnd(25) +
    "Status".padEnd(15) +
    "RBT".padEnd(25) +
    "Travel Time".padEnd(15) +
    "Reason"
  );
  console.log("-".repeat(100));

  for (const match of matches) {
    const rbtName = match.rbt ? match.rbt.full_name : "No Match";
    const travelTime = match.travelTimeMinutes ? `${match.travelTimeMinutes} min` : "-";
    const status = match.status.toUpperCase();
    
    console.log(
      match.client.name.substring(0, 24).padEnd(25) +
      status.padEnd(15) +
      rbtName.substring(0, 24).padEnd(25) +
      travelTime.padEnd(15) +
      (match.reason || "-").substring(0, 40)
    );
  }

  // =========================================================================
  // Write JSON Output
  // =========================================================================
  if (!config.writeMatchesJson) {
    console.log('\n⚠️  Skipping JSON output (WRITE_MATCHES_JSON=false)');
  } else {
    const jsonOutputPath = path.join(__dirname, "..", "public", "matches_data.json");
    const computedAt = new Date().toISOString();
    
    // Separate unmatched clients for convenience
    const unmatched = matches
      .filter(m => m.status === 'standby' || m.status === 'no_location')
      .map(m => ({
        clientId: m.client.id,
        clientName: m.client.name,
        status: m.status,
        reason: m.reason || 'Unknown',
      }));
    
    const jsonData = {
      generatedAt: computedAt,
      runId: runId,
      schedulingDBConfigured: isSchedulingDBConfigured(),
      matches: matches.map(m => mapMatchToFrontend(m)),
      rbts: rbts.map(r => mapRbtToFrontend(r)),
      clients: clients.map(c => mapClientToFrontend(c)),
      unmatched: unmatched,
      summary: {
        totalClients: matches.length,
        matched: matchedCount,
        standby: standbyCount,
        noLocation: noLocationCount,
        needsReview: needsReviewCount,
        totalRBTs: rbts.length,
        rbtsWithCoords: rbtsWithCoords.length,
        clientsWithCoords: clientsWithCoords.length,
      }
    };
    
    const publicDir = path.join(__dirname, "..", "public");
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }

    fs.writeFileSync(jsonOutputPath, JSON.stringify(jsonData, null, 2), "utf-8");
    console.log(`\n💾 JSON data written to: ${jsonOutputPath}`);
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log("\n" + "=".repeat(100));
  console.log("SUMMARY");
  console.log("=".repeat(100));
  console.log(`Total Clients: ${matches.length}`);
  console.log(`✅ Matched: ${matchedCount}`);
  console.log(`🔒 Locked: ${matchingResult.lockedCount}`);
  console.log(`🤖 Auto: ${matchingResult.autoCount}`);
  console.log(`🚫 Blocked: ${matchingResult.blockedCount}`);
  console.log(`⏳ Standby (no RBT within 30 min): ${standbyCount}`);
  console.log(`⚠️ Missing Location Info: ${noLocationCount}`);
  if (needsReviewCount > 0) {
    console.log(`🔍 Needs Review: ${needsReviewCount}`);
  }
  console.log(`👤 Total Active RBTs: ${rbts.length}`);
  console.log(`📞 Google API Calls: ${matchingResult.googleApiCalls}`);
  console.log(`💾 Cache Hits: ${matchingResult.cacheHits}`);
  if (totalRequests > 0) {
    console.log(`📈 Cache Hit Rate: ${cacheHitRate}%`);
  }
  console.log();
  
  // Geocoding recommendations
  if (rbtsNeedingGeocode.length > 0 || clientsNeedingGeocode.length > 0) {
    console.log("📍 GEOCODING RECOMMENDATIONS:");
    if (rbtsNeedingGeocode.length > 0) {
      console.log(`   Run: npm run geocode-rbts (${rbtsNeedingGeocode.length} RBTs need coordinates)`);
    }
    if (clientsNeedingGeocode.length > 0) {
      console.log(`   Run: npm run migrate-clients (${clientsNeedingGeocode.length} clients need coordinates)`);
    }
    console.log();
  }
}

// Run the program
main().catch(console.error);
