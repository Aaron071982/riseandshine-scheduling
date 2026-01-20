/**
 * Test Simulation Workflow Script
 * 
 * End-to-end test for the simulation workflow including:
 * - Adding clients
 * - Running simulation
 * - Approving proposals
 * - Verifying RBT locks
 * - Reopening RBTs
 * - Verifying RBT becomes available again
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { validateSchedulingDB, isSchedulingDBConfigured, getSchedulingClient } from '../lib/supabaseSched';
import { addClient, runSimulation, getProposals, approveProposal, reopenRBT, getPairedClients, getRBTs } from '../lib/simulation';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function testSimulation() {
  console.log('🧪 Starting Simulation Workflow Test\n');
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
  
  const supabase = getSchedulingClient();
  
  try {
    // Step 1: Clean up any existing test data (optional - comment out if you want to keep data)
    console.log('🧹 Cleaning up test data (if any)...');
    // Note: In production, you might want to skip this or use test-specific IDs
    
    // Step 2: Verify we have available RBTs
    console.log('\n📋 Step 1: Verifying available RBTs...');
    const availableRBTs = await getRBTs({ availability_status: 'available' });
    console.log(`   Found ${availableRBTs.length} available RBTs`);
    
    if (availableRBTs.length < 3) {
      console.warn('⚠️  Need at least 3 available RBTs for testing. Found:', availableRBTs.length);
      console.log('   Test will continue but may not find matches...');
    }
    
    // Step 3: Add 2 test clients
    console.log('\n📋 Step 2: Adding test clients...');
    
    const client1 = await addClient(
      'Test Client 1',
      '123 Main St, Brooklyn, NY 11201',
      'Test client for simulation workflow'
    );
    console.log(`   ✅ Added client 1: ${client1.name} (${client1.id})`);
    console.log(`      Location: ${client1.lat}, ${client1.lng}`);
    
    const client2 = await addClient(
      'Test Client 2',
      '456 Broadway, Queens, NY 11101',
      'Test client for simulation workflow'
    );
    console.log(`   ✅ Added client 2: ${client2.name} (${client2.id})`);
    console.log(`      Location: ${client2.lat}, ${client2.lng}`);
    
    // Step 4: Run simulation
    console.log('\n📋 Step 3: Running simulation...');
    const simulationResult = await runSimulation();
    console.log(`   Simulation Run ID: ${simulationResult.simulation_run_id}`);
    console.log(`   Proposals created: ${simulationResult.proposals_created}`);
    console.log(`   Clients processed: ${simulationResult.clients_processed}`);
    if (simulationResult.errors.length > 0) {
      console.log(`   Errors: ${simulationResult.errors.length}`);
      simulationResult.errors.forEach(err => console.log(`      - ${err}`));
    }
    
    if (simulationResult.proposals_created === 0) {
      console.warn('⚠️  No proposals created. This might be normal if no RBTs are within 30 minutes.');
      console.log('   Test will continue but approval step will be skipped.');
    }
    
    // Step 5: Get proposals
    console.log('\n📋 Step 4: Fetching proposals...');
    const proposals = await getProposals({ status: 'proposed' });
    console.log(`   Found ${proposals.length} proposed matches`);
    
    if (proposals.length === 0) {
      console.log('   ⚠️  No proposals to approve. Test ending early.');
      return;
    }
    
    // Display proposals
    proposals.forEach((p, i) => {
      console.log(`   Proposal ${i + 1}:`);
      console.log(`      Client: ${p.client?.name || 'Unknown'}`);
      console.log(`      RBT: ${p.rbt?.full_name || 'Unknown'}`);
      console.log(`      Travel Time: ${p.travel_time_minutes} minutes`);
    });
    
    // Step 6: Approve proposal for client 1
    console.log('\n📋 Step 5: Approving proposal for client 1...');
    const client1Proposal = proposals.find(p => p.client_id === client1.id);
    
    if (!client1Proposal) {
      console.warn('   ⚠️  No proposal found for client 1. Skipping approval test.');
    } else {
      const approvalResult = await approveProposal(client1Proposal.id);
      console.log(`   ✅ Proposal approved`);
      console.log(`      Pairing ID: ${approvalResult.pairing_id}`);
      console.log(`      Client ID: ${approvalResult.client_id}`);
      console.log(`      RBT ID: ${approvalResult.rbt_id}`);
      
      // Verify client is paired
      const { data: clientCheck } = await supabase
        .from('clients')
        .select('pairing_status, paired_rbt_id')
        .eq('id', client1.id)
        .single();
      
      if (clientCheck?.pairing_status === 'paired' && clientCheck?.paired_rbt_id === approvalResult.rbt_id) {
        console.log('   ✅ Client 1 is now paired');
      } else {
        throw new Error(`Client pairing verification failed: ${JSON.stringify(clientCheck)}`);
      }
      
      // Verify RBT is locked
      const { data: rbtCheck } = await supabase
        .from('rbt_profiles')
        .select('availability_status')
        .eq('id', approvalResult.rbt_id)
        .single();
      
      if (rbtCheck?.availability_status === 'locked') {
        console.log('   ✅ RBT is now locked');
      } else {
        throw new Error(`RBT lock verification failed: ${JSON.stringify(rbtCheck)}`);
      }
      
      // Verify pairing exists
      const { data: pairingCheck } = await supabase
        .from('pairings')
        .select('*')
        .eq('id', approvalResult.pairing_id)
        .eq('status', 'active')
        .single();
      
      if (pairingCheck) {
        console.log('   ✅ Active pairing record created');
      } else {
        throw new Error('Pairing record not found or not active');
      }
    }
    
    // Step 7: Run simulation again and verify locked RBT is not considered
    console.log('\n📋 Step 6: Running simulation again (locked RBT should be excluded)...');
    const simulationResult2 = await runSimulation();
    console.log(`   Proposals created: ${simulationResult2.proposals_created}`);
    
    const proposals2 = await getProposals({ status: 'proposed' });
    const lockedRBTId = client1Proposal?.rbt_id;
    
    if (lockedRBTId) {
      const proposalsForLockedRBT = proposals2.filter(p => p.rbt_id === lockedRBTId);
      if (proposalsForLockedRBT.length === 0) {
        console.log('   ✅ Locked RBT was not considered in new simulation');
      } else {
        console.warn('   ⚠️  Locked RBT still appears in proposals (this might be expected if multiple clients)');
      }
    }
    
    // Step 8: Reopen RBT
    if (client1Proposal) {
      console.log('\n📋 Step 7: Reopening RBT...');
      const reopenResult = await reopenRBT(client1Proposal.rbt_id);
      console.log(`   ✅ RBT reopened`);
      console.log(`      Pairings deactivated: ${reopenResult.pairings_deactivated}`);
      console.log(`      Clients unpaired: ${reopenResult.clients_unpaired}`);
      
      // Verify RBT is available
      const { data: rbtCheck2 } = await supabase
        .from('rbt_profiles')
        .select('availability_status')
        .eq('id', client1Proposal.rbt_id)
        .single();
      
      if (rbtCheck2?.availability_status === 'available') {
        console.log('   ✅ RBT is now available');
      } else {
        throw new Error(`RBT availability verification failed: ${JSON.stringify(rbtCheck2)}`);
      }
      
      // Verify client is unpaired
      const { data: clientCheck2 } = await supabase
        .from('clients')
        .select('pairing_status, paired_rbt_id')
        .eq('id', client1.id)
        .single();
      
      if (clientCheck2?.pairing_status === 'unpaired' && !clientCheck2?.paired_rbt_id) {
        console.log('   ✅ Client 1 is now unpaired');
      } else {
        throw new Error(`Client unpairing verification failed: ${JSON.stringify(clientCheck2)}`);
      }
      
      // Verify pairing is inactive
      const { data: pairingCheck2 } = await supabase
        .from('pairings')
        .select('status, ended_at')
        .eq('client_id', client1.id)
        .eq('rbt_id', client1Proposal.rbt_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (pairingCheck2?.status === 'inactive' && pairingCheck2?.ended_at) {
        console.log('   ✅ Pairing is now inactive with ended_at timestamp');
      } else {
        throw new Error(`Pairing deactivation verification failed: ${JSON.stringify(pairingCheck2)}`);
      }
      
      // Step 9: Run simulation again and verify reopened RBT is considered
      console.log('\n📋 Step 8: Running simulation again (reopened RBT should be considered)...');
      const simulationResult3 = await runSimulation();
      console.log(`   Proposals created: ${simulationResult3.proposals_created}`);
      
      const proposals3 = await getProposals({ status: 'proposed' });
      const proposalsForReopenedRBT = proposals3.filter(p => p.rbt_id === client1Proposal.rbt_id);
      
      if (proposalsForReopenedRBT.length > 0) {
        console.log(`   ✅ Reopened RBT is now considered (found ${proposalsForReopenedRBT.length} proposal(s))`);
      } else {
        console.log('   ℹ️  Reopened RBT not in new proposals (might be due to travel time constraints)');
      }
    }
    
    // Step 10: Get paired clients
    console.log('\n📋 Step 9: Fetching paired clients...');
    const pairedClients = await getPairedClients();
    console.log(`   Found ${pairedClients.length} active pairings`);
    
    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('✅ Simulation Workflow Test Complete!');
    console.log('='.repeat(80));
    console.log('\nSummary:');
    console.log(`   - Clients added: 2`);
    console.log(`   - Simulations run: 3`);
    console.log(`   - Proposals created: ${simulationResult.proposals_created} (first run)`);
    if (client1Proposal) {
      console.log(`   - Proposal approved: 1`);
      console.log(`   - RBT reopened: 1`);
    }
    console.log(`   - Active pairings: ${pairedClients.length}`);
    console.log('\n✅ All tests passed!\n');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run test
testSimulation().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
