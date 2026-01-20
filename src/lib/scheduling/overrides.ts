/**
 * Match Overrides Service
 * 
 * Manages manual match overrides, locked assignments, and blocked pairs.
 * Provides functions to query and manage override rules.
 */

import { getSchedulingClient, isSchedulingDBConfigured, isDBValidated } from '../supabaseSched';
import type { Client } from '../clients';
import type { RBT } from '../rbts';

export type OverrideType = 'LOCKED_ASSIGNMENT' | 'MANUAL_ASSIGNMENT' | 'BLOCK_PAIR';

export interface MatchOverride {
  id: string;
  client_id: string;
  rbt_id: string;
  type: OverrideType;
  created_by: string;
  notes?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateOverrideParams {
  clientId: string;
  rbtId: string;
  type: OverrideType;
  createdBy?: string;
  notes?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

/**
 * Gets all overrides for a specific client
 */
export async function getOverridesForClient(clientId: string): Promise<MatchOverride[]> {
  if (!isSchedulingDBConfigured() || !isDBValidated()) {
    return [];
  }

  try {
    const supabase = getSchedulingClient();
    const { data, error } = await supabase
      .from('match_overrides')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching overrides for client:', error);
      return [];
    }

    return (data || []) as MatchOverride[];
  } catch (error) {
    console.error('Failed to fetch overrides for client:', error);
    return [];
  }
}

/**
 * Gets all overrides for a specific RBT
 */
export async function getOverridesForRbt(rbtId: string): Promise<MatchOverride[]> {
  if (!isSchedulingDBConfigured() || !isDBValidated()) {
    return [];
  }

  try {
    const supabase = getSchedulingClient();
    const { data, error } = await supabase
      .from('match_overrides')
      .select('*')
      .eq('rbt_id', rbtId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching overrides for RBT:', error);
      return [];
    }

    return (data || []) as MatchOverride[];
  } catch (error) {
    console.error('Failed to fetch overrides for RBT:', error);
    return [];
  }
}

/**
 * Gets all blocked pairs
 * Returns a Set of string keys in format "clientId:rbtId" for fast lookup
 */
export async function getBlockedPairs(): Promise<Set<string>> {
  if (!isSchedulingDBConfigured() || !isDBValidated()) {
    return new Set();
  }

  try {
    const supabase = getSchedulingClient();
    const now = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    
    // Get all BLOCK_PAIR overrides
    const { data, error } = await supabase
      .from('match_overrides')
      .select('client_id, rbt_id, effective_from, effective_to')
      .eq('type', 'BLOCK_PAIR');

    if (error) {
      console.error('Error fetching blocked pairs:', error);
      return new Set();
    }

    const blockedSet = new Set<string>();
    (data || []).forEach((override: any) => {
      // Check if override is currently effective
      const from = override.effective_from;
      const to = override.effective_to;
      const isEffective = (!from || from <= now) && (!to || to >= now);
      
      if (isEffective) {
        blockedSet.add(`${override.client_id}:${override.rbt_id}`);
      }
    });

    return blockedSet;
  } catch (error) {
    console.error('Failed to fetch blocked pairs:', error);
    return new Set();
  }
}

/**
 * Gets all locked assignments
 * Returns array of { client, rbt } pairs with full objects
 * Note: This requires loading Client and RBT objects, so it's more expensive
 */
export async function getLockedAssignments(): Promise<Array<{ client: Client; rbt: RBT }>> {
  if (!isSchedulingDBConfigured() || !isDBValidated()) {
    return [];
  }

  try {
    const supabase = getSchedulingClient();
    const now = new Date().toISOString().split('T')[0];
    
    // Get all LOCKED_ASSIGNMENT overrides
    const { data: overrides, error } = await supabase
      .from('match_overrides')
      .select('client_id, rbt_id, effective_from, effective_to')
      .eq('type', 'LOCKED_ASSIGNMENT');

    if (error || !overrides || overrides.length === 0) {
      return [];
    }

    // Load clients and RBTs
    const { loadClients } = await import('../clients');
    const { getActiveRBTs } = await import('../rbts');
    
    const clients = await loadClients();
    const rbts = await getActiveRBTs();

      // Map overrides to full objects
      const lockedAssignments: Array<{ client: Client; rbt: RBT }> = [];
      
      for (const override of overrides) {
        const client = clients.find(c => c.id === override.client_id);
        const rbt = rbts.find(r => r.id === override.rbt_id);
        
      if (client && rbt) {
        // Check if override is currently effective
        const from = override.effective_from;
        const to = override.effective_to;
        const isEffective = (!from || from <= now) && (!to || to >= now);
        
        if (isEffective) {
          lockedAssignments.push({ client, rbt });
        }
      }
      }

    return lockedAssignments;
  } catch (error) {
    console.error('Failed to fetch locked assignments:', error);
    return [];
  }
}

/**
 * Gets a simpler version of locked assignments (just IDs)
 * More efficient for matching algorithm
 */
export async function getLockedAssignmentIds(): Promise<Array<{ clientId: string; rbtId: string }>> {
  if (!isSchedulingDBConfigured() || !isDBValidated()) {
    return [];
  }

  try {
    const supabase = getSchedulingClient();
    const now = new Date().toISOString().split('T')[0];
    
    // Get all LOCKED_ASSIGNMENT overrides
    const { data, error } = await supabase
      .from('match_overrides')
      .select('client_id, rbt_id, effective_from, effective_to')
      .eq('type', 'LOCKED_ASSIGNMENT');

    if (error || !data) {
      return [];
    }

    // Filter by effective dates
    return data
      .filter((override: any) => {
        const from = override.effective_from;
        const to = override.effective_to;
        return (!from || from <= now) && (!to || to >= now);
      })
      .map((override: any) => ({
        clientId: override.client_id,
        rbtId: override.rbt_id,
      }));
  } catch (error) {
    console.error('Failed to fetch locked assignment IDs:', error);
    return [];
  }
}

/**
 * Checks if a specific client-RBT pair is blocked
 */
export async function isPairBlocked(clientId: string, rbtId: string): Promise<boolean> {
  const blockedPairs = await getBlockedPairs();
  return blockedPairs.has(`${clientId}:${rbtId}`);
}

/**
 * Creates a new override
 */
export async function createOverride(params: CreateOverrideParams): Promise<MatchOverride | null> {
  if (!isSchedulingDBConfigured() || !isDBValidated()) {
    return null;
  }

  try {
    const supabase = getSchedulingClient();
    const { data, error } = await supabase
      .from('match_overrides')
      .insert({
        client_id: params.clientId,
        rbt_id: params.rbtId,
        type: params.type,
        created_by: params.createdBy || 'admin',
        notes: params.notes || null,
        effective_from: params.effectiveFrom || null,
        effective_to: params.effectiveTo || null,
      })
      .select()
      .single();

    if (error) {
      // Handle unique constraint violation (pair already has override)
      if (error.code === '23505') {
        // Update existing override instead
        const { data: updated, error: updateError } = await supabase
          .from('match_overrides')
          .update({
            type: params.type,
            notes: params.notes || null,
            effective_from: params.effectiveFrom || null,
            effective_to: params.effectiveTo || null,
            updated_at: new Date().toISOString(),
          })
          .eq('client_id', params.clientId)
          .eq('rbt_id', params.rbtId)
          .select()
          .single();

        if (updateError) {
          throw updateError;
        }

        return updated as MatchOverride;
      }
      throw error;
    }

    return data as MatchOverride;
  } catch (error) {
    console.error('Failed to create override:', error);
    throw error;
  }
}

/**
 * Deletes an override by ID
 */
export async function deleteOverride(overrideId: string): Promise<boolean> {
  if (!isSchedulingDBConfigured() || !isDBValidated()) {
    return false;
  }

  try {
    const supabase = getSchedulingClient();
    const { error } = await supabase
      .from('match_overrides')
      .delete()
      .eq('id', overrideId);

    if (error) {
      console.error('Error deleting override:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Failed to delete override:', error);
    return false;
  }
}

/**
 * Deletes an override by client and RBT IDs
 */
export async function deleteOverrideByPair(clientId: string, rbtId: string): Promise<boolean> {
  if (!isSchedulingDBConfigured() || !isDBValidated()) {
    return false;
  }

  try {
    const supabase = getSchedulingClient();
    const { error } = await supabase
      .from('match_overrides')
      .delete()
      .eq('client_id', clientId)
      .eq('rbt_id', rbtId);

    if (error) {
      console.error('Error deleting override by pair:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Failed to delete override by pair:', error);
    return false;
  }
}

/**
 * Gets a specific override by client and RBT IDs
 */
export async function getOverrideById(clientId: string, rbtId: string): Promise<MatchOverride | null> {
  if (!isSchedulingDBConfigured() || !isDBValidated()) {
    return null;
  }

  try {
    const supabase = getSchedulingClient();
    const { data, error } = await supabase
      .from('match_overrides')
      .select('*')
      .eq('client_id', clientId)
      .eq('rbt_id', rbtId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return data as MatchOverride;
  } catch (error) {
    console.error('Failed to fetch override:', error);
    return null;
  }
}

/**
 * Gets all overrides (with optional filters)
 */
export async function getAllOverrides(filters?: {
  type?: OverrideType;
  clientId?: string;
  rbtId?: string;
}): Promise<MatchOverride[]> {
  if (!isSchedulingDBConfigured() || !isDBValidated()) {
    return [];
  }

  try {
    const supabase = getSchedulingClient();
    let query = supabase
      .from('match_overrides')
      .select('*');

    if (filters?.type) {
      query = query.eq('type', filters.type);
    }
    if (filters?.clientId) {
      query = query.eq('client_id', filters.clientId);
    }
    if (filters?.rbtId) {
      query = query.eq('rbt_id', filters.rbtId);
    }

    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching overrides:', error);
      return [];
    }

    return (data || []) as MatchOverride[];
  } catch (error) {
    console.error('Failed to fetch overrides:', error);
    return [];
  }
}
