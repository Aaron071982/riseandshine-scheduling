import * as path from "path";
import * as fs from "fs";
import { loadClientsFromCsv } from "./lib/clients";
import { getActiveRBTs } from "./lib/rbts";
import { matchClientsToRBTs } from "./lib/scheduling/matcher";

async function main() {
  console.log("🚀 Starting Scheduling AI Matching System with Supabase...\n");
  
  // Load RBTs from Supabase
  console.log("📂 Loading RBTs from Supabase...");
  const rbts = await getActiveRBTs();
  console.log(`   Loaded ${rbts.length} active RBTs from Supabase\n`);

  if (rbts.length === 0) {
    console.warn("⚠️  No RBTs found in Supabase. Using CSV fallback...");
    // Fallback to CSV if Supabase is empty
    const { loadRBTs } = require("./csvLoader");
    const rbtPath = path.join(__dirname, "..", "rbt.csv");
    const csvRbts = loadRBTs(rbtPath);
    console.log(`   Loaded ${csvRbts.length} RBTs from CSV\n`);
    
    // Convert CSV RBTs to the format expected by matcher
    // This is a temporary fallback
    return;
  }

  // Load clients from CSV
  console.log("📂 Loading Clients from CSV...");
  const clients = await loadClientsFromCsv();
  console.log(`   Loaded ${clients.length} clients\n`);

  // Run matching algorithm
  console.log("🔍 Running matching algorithm...\n");
  const matches = await matchClientsToRBTs(clients, rbts);
  
  // Display results
  console.log("\n" + "=".repeat(100));
  console.log("MATCHING RESULTS");
  console.log("=".repeat(100));
  console.log();

  const matchedCount = matches.filter(m => m.status === 'matched').length;
  const standbyCount = matches.filter(m => m.status === 'standby').length;
  const noLocationCount = matches.filter(m => m.status === 'no_location').length;

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
      match.client.name.padEnd(25) +
      status.padEnd(15) +
      rbtName.padEnd(25) +
      travelTime.padEnd(15) +
      (match.reason || "-")
    );
  }

  // Write JSON output for frontend
  const jsonOutputPath = path.join(__dirname, "..", "public", "matches_data.json");
  const jsonData = {
    matches: matches.map(m => ({
      clientId: m.client.id,
      clientName: m.client.name,
      clientLocation: m.client.locationBorough,
      clientAddress: m.client.address_line || `${m.client.city}, ${m.client.state} ${m.client.zip}`,
      clientZip: m.client.zip,
      clientStatus: m.client.status,
      clientNeedsLocation: m.client.needsLocationInfo,
      rbtId: m.rbt?.id || null,
      rbtName: m.rbt?.full_name || null,
      rbtLocation: m.rbt ? `${m.rbt.city || ''}, ${m.rbt.state || ''} ${m.rbt.zip || ''}`.trim() : null,
      rbtZip: m.rbt?.zip || null,
      travelTimeMinutes: m.travelTimeMinutes,
      travelTimeSeconds: m.travelTimeSeconds,
      distanceMiles: m.distanceMiles,
      status: m.status,
      reason: m.reason,
      travelMode: m.travelMode || (m.rbt?.transport_mode === 'Transit' ? 'transit' : m.rbt?.transport_mode === 'Both' ? 'driving' : 'driving'),
      rbtTransportMode: m.rbt?.transport_mode || 'Both',
      rbtGender: m.rbt?.gender || null,
      rbtOnboardingComplete: m.rbt?.onboardingComplete || false
    })),
        rbts: rbts.map(r => ({
          id: r.id,
          name: r.full_name,
          location: `${r.city || ''}, ${r.state || ''} ${r.zip || ''}`.trim(),
          zip: r.zip,
          transportMode: r.transport_mode || 'Both',
          gender: r.gender || null,
          fortyHourCourseComplete: r.fortyHourCourseComplete || false,
          fortyHourCourseLink: r.fortyHourCourseLink || null,
          email: r.email,
          phone: r.phone
        })),
    clients: clients.map(c => ({
      id: c.id,
      name: c.name,
      location: c.locationBorough,
      address: c.address_line || `${c.city}, ${c.state} ${c.zip}`.trim(),
      zip: c.zip,
      status: c.status,
      needsLocationInfo: c.needsLocationInfo
    })),
    summary: {
      totalClients: matches.length,
      matchedCount,
      standbyCount,
      noLocationCount,
      totalRBTs: rbts.length
    }
  };

  const publicDir = path.join(__dirname, "..", "public");
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  fs.writeFileSync(jsonOutputPath, JSON.stringify(jsonData, null, 2), "utf-8");
  console.log(`\n💾 JSON data written to: ${jsonOutputPath}`);

  // Summary
  console.log("\n" + "=".repeat(100));
  console.log("SUMMARY");
  console.log("=".repeat(100));
  console.log(`Total Clients: ${matches.length}`);
  console.log(`✅ Matched: ${matchedCount}`);
  console.log(`⏳ Standby (no RBT within 30 min): ${standbyCount}`);
  console.log(`⚠️  Missing Location Info: ${noLocationCount}`);
  console.log(`👤 Total Active RBTs: ${rbts.length}`);
  console.log();
}

// Run the program
main().catch(console.error);
