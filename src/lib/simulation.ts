/**
 * Simulation Workflow Data Access Layer
 * 
 * Handles manual client entry, simulation runs, proposal management,
 * and pairing operations for the simulation-based matching workflow.
 */

import { getSchedulingClient, isDBValidated } from './supabaseSched';
import { geocodeWithPrecision, type GeocodeResult } from './geocoding/geocode';
import { getCachedTravelTime } from './scheduling/travelTimeCache';
import { randomUUID } from 'crypto';

export interface SimulationClient {
  id: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  pairing_status: 'unpaired' | 'paired';
  paired_rbt_id: string | null;
  notes?: string | null;
  created_at: string;
}

export interface SimulationRBT {
  id: string;
  full_name: string;
  lat: number | null;
  lng: number | null;
  availability_status: 'available' | 'locked';
}

export interface MatchProposal {
  id: string;
  client_id: string;
  rbt_id: string;
  travel_time_minutes: number;
  distance_meters: number | null;
  status: 'proposed' | 'approved' | 'rejected' | 'expired' | 'deferred';
  simulation_run_id: string;
  created_at: string;
  // Joined data
  client?: SimulationClient;
  rbt?: SimulationRBT;
}

export interface Pairing {
  id: string;
  client_id: string;
  rbt_id: string;
  proposal_id: string | null;
  status: 'active' | 'inactive';
  created_at: string;
  ended_at: string | null;
  // Joined data
  client?: SimulationClient;
  rbt?: SimulationRBT;
}

export interface SimulationResult {
  simulation_run_id: string;
  proposals_created: number;
  clients_processed: number;
  errors: string[];
}

/**
 * Add a new client manually with geocoding
 */
export async function addClient(
  name: string,
  address: string,
  notes?: string
): Promise<SimulationClient> {
  if (!isDBValidated()) {
    throw new Error('Database not validated');
  }

  const supabase = getSchedulingClient();

  // Geocode the address
  const geocodeResult = await geocodeWithPrecision(address);
  
  if ('error' in geocodeResult) {
    throw new Error(`Geocoding failed: ${geocodeResult.message}`);
  }

  const geo: GeocodeResult = geocodeResult;

  // Insert client
  const { data, error } = await supabase
    .from('clients')
    .insert({
      name,
      address_line: address,
      lat: geo.lat,
      lng: geo.lng,
      geocode_precision: geo.precision,
      geocode_confidence: geo.confidence,
      geocode_source: 'manual_entry',
      geocode_updated_at: new Date().toISOString(),
      geocode_address_used: geo.addressUsed,
      notes: notes || null,
      pairing_status: 'unpaired',
      paired_rbt_id: null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create client: ${error.message}`);
  }

  return {
    id: data.id,
    name: data.name,
    address: data.address_line || '',
    lat: data.lat ? parseFloat(data.lat.toString()) : null,
    lng: data.lng ? parseFloat(data.lng.toString()) : null,
    pairing_status: data.pairing_status || 'unpaired',
    paired_rbt_id: data.paired_rbt_id || null,
    notes: data.notes || null,
    created_at: data.created_at,
  };
}

/**
 * Run simulation to create proposals for unpaired clients
 */
export async function runSimulation(): Promise<SimulationResult> {
  if (!isDBValidated()) {
    throw new Error('Database not validated');
  }

  const supabase = getSchedulingClient();
  const simulation_run_id = randomUUID();
  const errors: string[] = [];
  let proposals_created = 0;
  let clients_processed = 0;

  // Get unpaired clients
  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, name, lat, lng, pairing_status')
    .eq('pairing_status', 'unpaired')
    .not('lat', 'is', null)
    .not('lng', 'is', null);

  if (clientsError) {
    throw new Error(`Failed to fetch clients: ${clientsError.message}`);
  }

  if (!clients || clients.length === 0) {
    return {
      simulation_run_id,
      proposals_created: 0,
      clients_processed: 0,
      errors: ['No unpaired clients with valid coordinates found'],
    };
  }

  // Get available RBTs with proper zip codes
  const { data: rbts, error: rbtsError } = await supabase
    .from('rbt_profiles')
    .select('id, full_name, lat, lng, availability_status, zip_code')
    .eq('availability_status', 'available')
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .not('zip_code', 'is', null)
    .neq('zip_code', '');

  if (rbtsError) {
    throw new Error(`Failed to fetch RBTs: ${rbtsError.message}`);
  }

  if (!rbts || rbts.length === 0) {
    return {
      simulation_run_id,
      proposals_created: 0,
      clients_processed: clients.length,
      errors: ['No available RBTs with valid coordinates found'],
    };
  }

  // Process each client
  for (const client of clients) {
    try {
      clients_processed++;

      // Expire old proposals for this client (but keep deferred ones)
      await supabase
        .from('match_proposals')
        .update({ status: 'expired' })
        .eq('client_id', client.id)
        .eq('status', 'proposed');

      // Find best RBT match (minimum travel time <= 30 minutes)
      let bestRBT: typeof rbts[0] | null = null;
      let bestTravelTime: number | null = null;
      let bestDistance: number | null = null;

      const clientLat = parseFloat(client.lat.toString());
      const clientLng = parseFloat(client.lng.toString());

      for (const rbt of rbts) {
        const rbtLat = parseFloat(rbt.lat.toString());
        const rbtLng = parseFloat(rbt.lng.toString());

        try {
          // Get travel time from cache
          const travelResult = await getCachedTravelTime({
            originLat: clientLat,
            originLng: clientLng,
            destLat: rbtLat,
            destLng: rbtLng,
            mode: 'driving',
            originType: 'client',
            destType: 'rbt',
            originId: client.id,
            destId: rbt.id,
          });

          if (!travelResult) {
            continue; // Skip if no travel time available
          }

          const travelTimeMinutes = Math.round(travelResult.durationSec / 60);
          const distanceMeters = travelResult.distanceMeters;

          // Hard constraint: must be <= 30 minutes
          if (travelTimeMinutes <= 30) {
            if (bestTravelTime === null || travelTimeMinutes < bestTravelTime) {
              bestRBT = rbt;
              bestTravelTime = travelTimeMinutes;
              bestDistance = distanceMeters;
            }
          }
        } catch (err) {
          // Log error but continue with other RBTs
          errors.push(`Error computing travel time for client ${client.id} to RBT ${rbt.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Create proposal if best match found
      if (bestRBT && bestTravelTime !== null) {
        const { error: proposalError } = await supabase
          .from('match_proposals')
          .insert({
            client_id: client.id,
            rbt_id: bestRBT.id,
            travel_time_minutes: bestTravelTime,
            distance_meters: bestDistance,
            status: 'proposed',
            simulation_run_id,
          });

        if (proposalError) {
          errors.push(`Failed to create proposal for client ${client.id}: ${proposalError.message}`);
        } else {
          proposals_created++;
        }
      }
    } catch (err) {
      errors.push(`Error processing client ${client.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    simulation_run_id,
    proposals_created,
    clients_processed,
    errors,
  };
}

/**
 * Get proposals with optional filters
 */
export async function getProposals(filters?: {
  status?: 'proposed' | 'approved' | 'rejected' | 'expired' | 'deferred';
  simulation_run_id?: string;
}): Promise<MatchProposal[]> {
  if (!isDBValidated()) {
    throw new Error('Database not validated');
  }

  const supabase = getSchedulingClient();
  let query = supabase
    .from('match_proposals')
    .select(`
      *,
      clients:client_id (
        id, name, address_line, lat, lng, pairing_status, paired_rbt_id, notes, created_at
      ),
      rbt_profiles:rbt_id (
        id, full_name, lat, lng, availability_status
      )
    `)
    .order('created_at', { ascending: false });

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }

  if (filters?.simulation_run_id) {
    query = query.eq('simulation_run_id', filters.simulation_run_id);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch proposals: ${error.message}`);
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    client_id: row.client_id,
    rbt_id: row.rbt_id,
    travel_time_minutes: row.travel_time_minutes,
    distance_meters: row.distance_meters,
    status: row.status,
    simulation_run_id: row.simulation_run_id,
    created_at: row.created_at,
    client: row.clients ? {
      id: row.clients.id,
      name: row.clients.name,
      address: row.clients.address_line || '',
      lat: row.clients.lat ? parseFloat(row.clients.lat.toString()) : null,
      lng: row.clients.lng ? parseFloat(row.clients.lng.toString()) : null,
      pairing_status: row.clients.pairing_status || 'unpaired',
      paired_rbt_id: row.clients.paired_rbt_id || null,
      notes: row.clients.notes || null,
      created_at: row.clients.created_at,
    } : undefined,
    rbt: row.rbt_profiles ? {
      id: row.rbt_profiles.id,
      full_name: row.rbt_profiles.full_name,
      lat: row.rbt_profiles.lat ? parseFloat(row.rbt_profiles.lat.toString()) : null,
      lng: row.rbt_profiles.lng ? parseFloat(row.rbt_profiles.lng.toString()) : null,
      availability_status: row.rbt_profiles.availability_status || 'available',
    } : undefined,
  }));
}

/**
 * Approve a proposal (calls RPC function)
 */
export async function approveProposal(proposalId: string): Promise<any> {
  if (!isDBValidated()) {
    throw new Error('Database not validated');
  }

  const supabase = getSchedulingClient();
  const { data, error } = await supabase.rpc('approve_match_proposal', {
    proposal_id: proposalId,
  });

  if (error) {
    throw new Error(`Failed to approve proposal: ${error.message}`);
  }

  return data;
}

/**
 * Reject a proposal (calls RPC function)
 */
export async function rejectProposal(proposalId: string): Promise<any> {
  if (!isDBValidated()) {
    throw new Error('Database not validated');
  }

  const supabase = getSchedulingClient();
  const { data, error } = await supabase.rpc('reject_match_proposal', {
    proposal_id: proposalId,
  });

  if (error) {
    throw new Error(`Failed to reject proposal: ${error.message}`);
  }

  return data;
}

/**
 * Defer a proposal (stall for later review)
 */
export async function deferProposal(proposalId: string): Promise<any> {
  if (!isDBValidated()) {
    throw new Error('Database not validated');
  }

  const supabase = getSchedulingClient();
  const { data, error } = await supabase
    .from('match_proposals')
    .update({ status: 'deferred' })
    .eq('id', proposalId)
    .eq('status', 'proposed')
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to defer proposal: ${error.message}`);
  }

  return data;
}

/**
 * Reopen an RBT (calls RPC function)
 */
export async function reopenRBT(rbtId: string): Promise<any> {
  if (!isDBValidated()) {
    throw new Error('Database not validated');
  }

  const supabase = getSchedulingClient();
  const { data, error } = await supabase.rpc('reopen_rbt', {
    rbt_id: rbtId,
  });

  if (error) {
    throw new Error(`Failed to reopen RBT: ${error.message}`);
  }

  return data;
}

/**
 * Get paired clients (active pairings only)
 */
export async function getPairedClients(): Promise<Pairing[]> {
  if (!isDBValidated()) {
    throw new Error('Database not validated');
  }

  const supabase = getSchedulingClient();
  const { data, error } = await supabase
    .from('pairings')
    .select(`
      *,
      clients:client_id (
        id, name, address_line, lat, lng, pairing_status, paired_rbt_id, notes, created_at
      ),
      rbt_profiles:rbt_id (
        id, full_name, lat, lng, availability_status
      )
    `)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch paired clients: ${error.message}`);
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    client_id: row.client_id,
    rbt_id: row.rbt_id,
    proposal_id: row.proposal_id,
    status: row.status,
    created_at: row.created_at,
    ended_at: row.ended_at || null,
    client: row.clients ? {
      id: row.clients.id,
      name: row.clients.name,
      address: row.clients.address_line || '',
      lat: row.clients.lat ? parseFloat(row.clients.lat.toString()) : null,
      lng: row.clients.lng ? parseFloat(row.clients.lng.toString()) : null,
      pairing_status: row.clients.pairing_status || 'unpaired',
      paired_rbt_id: row.clients.paired_rbt_id || null,
      notes: row.clients.notes || null,
      created_at: row.clients.created_at,
    } : undefined,
    rbt: row.rbt_profiles ? {
      id: row.rbt_profiles.id,
      full_name: row.rbt_profiles.full_name,
      lat: row.rbt_profiles.lat ? parseFloat(row.rbt_profiles.lat.toString()) : null,
      lng: row.rbt_profiles.lng ? parseFloat(row.rbt_profiles.lng.toString()) : null,
      availability_status: row.rbt_profiles.availability_status || 'available',
    } : undefined,
  }));
}

/**
 * Get RBTs with optional availability filter
 */
export async function getRBTs(filters?: {
  availability_status?: 'available' | 'locked';
}): Promise<SimulationRBT[]> {
  if (!isDBValidated()) {
    throw new Error('Database not validated');
  }

  const supabase = getSchedulingClient();
  let query = supabase
    .from('rbt_profiles')
    .select('id, full_name, lat, lng, availability_status');

  if (filters?.availability_status) {
    query = query.eq('availability_status', filters.availability_status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch RBTs: ${error.message}`);
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    full_name: row.full_name,
    lat: row.lat ? parseFloat(row.lat.toString()) : null,
    lng: row.lng ? parseFloat(row.lng.toString()) : null,
    availability_status: row.availability_status || 'available',
  }));
}
