/**
 * Client Sync Service
 * 
 * Syncs clients from CRM database into Scheduling DB (canonical storage).
 * Handles:
 * - Upserting clients by crm_id
 * - Detecting address changes (marks coords_stale)
 * - Geocoding if needed
 * - Cache invalidation on coordinate changes
 * - Tracking sync runs
 */

import { loadClientsFromCrm } from './loadClientsFromCrm';
import { getSchedulingClient, isSchedulingDBConfigured, isDBValidated } from '../supabaseSched';
import { geocodeWithPrecision } from '../geocoding/geocode';
import { invalidateCacheForEntity } from './travelTimeCache';
import type { Client } from '../clients';

/**
 * Builds full address string from client components
 */
function buildClientAddress(client: Client): string {
  const parts: string[] = [];
  
  if (client.locationBorough && client.locationBorough !== 'Unknown') {
    if (client.address_line) {
      parts.push(client.address_line);
    }
    parts.push(client.locationBorough);
    parts.push(client.state || 'NY');
    if (client.zip) {
      parts.push(client.zip);
    }
  } else {
    if (client.address_line) {
      parts.push(client.address_line);
    }
    if (client.city) {
      parts.push(client.city);
    }
    if (client.state) {
      parts.push(client.state);
    }
    if (client.zip) {
      parts.push(client.zip);
    }
  }

  const address = parts.join(', ');
  
  if (address && (address.includes(',') || address.includes(' '))) {
    return address;
  }
  
  if (client.locationBorough && client.locationBorough !== 'Unknown') {
    return `${client.locationBorough}, NY`;
  }
  
  return address || '';
}

export interface SyncResult {
  success: boolean;
  recordsUpserted: number;
  recordsSkipped: number;
  recordsFailed: number;
  errors: string[];
  syncRunId: string | null;
}

/**
 * Syncs clients from CRM to Scheduling DB
 * 
 * @returns Sync result with statistics
 */
export async function syncClientsFromCrm(): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    recordsUpserted: 0,
    recordsSkipped: 0,
    recordsFailed: 0,
    errors: [],
    syncRunId: null,
  };

  if (!isSchedulingDBConfigured() || !isDBValidated()) {
    result.errors.push('Scheduling DB not configured or validated');
    return result;
  }

  const supabase = getSchedulingClient();

  // Create sync run record
  let syncRunId: string | null = null;
  try {
    const { data: syncRun, error: runError } = await supabase
      .from('client_sync_runs')
      .insert({
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (runError || !syncRun) {
      result.errors.push(`Failed to create sync run: ${runError?.message || 'Unknown error'}`);
      return result;
    }

    syncRunId = syncRun.id;
    result.syncRunId = syncRunId;
  } catch (error) {
    result.errors.push(`Failed to create sync run: ${error instanceof Error ? error.message : String(error)}`);
    return result;
  }

  try {
    // Load clients from CRM
    console.log('\n🔄 Starting CRM client sync...');
    let crmClients: Client[];
    
    try {
      crmClients = await loadClientsFromCrm();
    } catch (crmError) {
      // CRM unavailable - fail gracefully
      const errorMsg = crmError instanceof Error ? crmError.message : String(crmError);
      console.warn('⚠️ CRM unavailable, sync failed:', errorMsg);
      result.errors.push(`CRM unavailable: ${errorMsg}`);
      
      await updateSyncRun(supabase, syncRunId, 'failed', {
        error: `CRM unavailable: ${errorMsg}`,
      });
      
      // Don't mark as success, but don't crash
      result.success = false;
      return result;
    }

    if (crmClients.length === 0) {
      console.log('⚠️ No clients found in CRM');
      await updateSyncRun(supabase, syncRunId, 'completed', {
        records_upserted: 0,
        records_skipped: 0,
        records_failed: 0,
      });
      result.success = true;
      return result;
    }

    console.log(`   Found ${crmClients.length} clients in CRM`);

    // Process each client
    for (const crmClient of crmClients) {
      try {
        // Extract CRM ID from internal ID format (crm:<id>)
        const crmId = crmClient.id.replace(/^crm:/, '');
        
        // Check if client exists in Scheduling DB by crm_id
        const { data: existing, error: fetchError } = await supabase
          .from('clients')
          .select('*')
          .eq('crm_id', crmId)
          .maybeSingle();

        if (fetchError && fetchError.code !== 'PGRST116') {
          // PGRST116 = no rows returned, which is fine
          throw new Error(`Failed to fetch existing client: ${fetchError.message}`);
        }

        // Check if address changed (compare key fields)
        let addressChanged = false;
        let coordsChanged = false;
        
        if (existing) {
          const existingAddr = `${existing.address_line || ''}|${existing.zip || ''}|${existing.location_borough || ''}`;
          const newAddr = `${crmClient.address_line || ''}|${crmClient.zip || ''}|${crmClient.locationBorough || ''}`;
          addressChanged = existingAddr !== newAddr;

          // Check if coordinates changed
          const existingLat = existing.lat ? parseFloat(existing.lat.toString()) : null;
          const existingLng = existing.lng ? parseFloat(existing.lng.toString()) : null;
          coordsChanged = (existingLat !== crmClient.lat) || (existingLng !== crmClient.lng);
        }

        // Determine if we need to geocode
        let finalLat = crmClient.lat;
        let finalLng = crmClient.lng;
        let geocodePrecision = crmClient.geocode_precision;
        let geocodeConfidence = crmClient.geocode_confidence;
        let geocodeSource = crmClient.geocode_source;
        let geocodeAddressUsed = crmClient.geocode_address_used;

        // If no coordinates or address changed, geocode
        if ((!finalLat || !finalLng) || (addressChanged && !coordsChanged)) {
          const address = buildClientAddress(crmClient);
          if (address) {
            console.log(`   📍 Geocoding ${crmClient.name}...`);
            const geocodeResult = await geocodeWithPrecision(address);
            
            if ('error' in geocodeResult) {
              console.warn(`   ⚠️ Geocoding failed for ${crmClient.name}: ${geocodeResult.message}`);
              // Continue with existing coords if available, or mark as needs verification
            } else {
              finalLat = geocodeResult.lat;
              finalLng = geocodeResult.lng;
              geocodePrecision = geocodeResult.precision;
              geocodeConfidence = geocodeResult.confidence;
              geocodeSource = geocodeResult.source;
              geocodeAddressUsed = geocodeResult.addressUsed;
            }
          }
        }

        // Prepare client data for upsert
        const clientData: any = {
          name: crmClient.name,
          status: crmClient.status || null,
          phone: crmClient.phone || null,
          age: crmClient.age || null,
          address_line: crmClient.address_line || null,
          city: crmClient.city || null,
          state: crmClient.state || 'NY',
          zip: crmClient.zip || null,
          location_borough: crmClient.locationBorough || null,
          lat: finalLat,
          lng: finalLng,
          geocode_precision: geocodePrecision,
          geocode_confidence: geocodeConfidence,
          geocode_source: geocodeSource || 'crm_import',
          geocode_address_used: geocodeAddressUsed,
          geocode_updated_at: geocodePrecision ? new Date().toISOString() : null,
          needs_location_verification: !finalLat || !finalLng || (geocodePrecision === 'APPROXIMATE') || (geocodeConfidence !== null && geocodeConfidence !== undefined && geocodeConfidence < 0.5) || false,
          notes: crmClient.notes || null,
          crm_id: crmId,
          crm_synced_at: new Date().toISOString(),
          source_updated_at: new Date().toISOString(),
          // Mark coords as stale if address changed but we haven't updated coords yet
          coords_stale: addressChanged && !coordsChanged && (!finalLat || !finalLng),
          updated_at: new Date().toISOString(),
        };

        // Upsert by crm_id
        const { data: upserted, error: upsertError } = await supabase
          .from('clients')
          .upsert(clientData, {
            onConflict: 'crm_id',
            ignoreDuplicates: false,
          })
          .select('id')
          .single();

        if (upsertError) {
          throw new Error(`Failed to upsert client: ${upsertError.message}`);
        }

        if (!upserted) {
          result.recordsSkipped++;
          continue;
        }

        // If coordinates changed, invalidate cache
        if (coordsChanged && upserted.id) {
          await invalidateCacheForEntity('client', upserted.id);
        }

        result.recordsUpserted++;
        console.log(`   ✅ Synced ${crmClient.name} (${upserted.id.substring(0, 8)}...)`);

      } catch (error) {
        result.recordsFailed++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Failed to sync ${crmClient.name}: ${errorMsg}`);
        console.error(`   ❌ Failed to sync ${crmClient.name}:`, errorMsg);
      }
    }

    // Update sync run as completed
    await updateSyncRun(supabase, syncRunId, 'completed', {
      records_upserted: result.recordsUpserted,
      records_skipped: result.recordsSkipped,
      records_failed: result.recordsFailed,
      metadata: {
        errors: result.errors,
      },
    });

    result.success = true;
    console.log(`\n✅ Sync completed: ${result.recordsUpserted} upserted, ${result.recordsSkipped} skipped, ${result.recordsFailed} failed`);

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Sync failed: ${errorMsg}`);
    console.error('❌ Sync failed:', errorMsg);

    // Update sync run as failed
    await updateSyncRun(supabase, syncRunId, 'failed', {
      error: errorMsg,
    });
  }

  return result;
}

/**
 * Updates sync run record
 */
async function updateSyncRun(
  supabase: any,
  syncRunId: string | null,
  status: 'running' | 'completed' | 'failed',
  data: {
    records_upserted?: number;
    records_skipped?: number;
    records_failed?: number;
    error?: string;
    metadata?: any;
  }
): Promise<void> {
  if (!syncRunId) return;

  try {
    const updateData: any = {
      status,
      ended_at: new Date().toISOString(),
    };

    if (data.records_upserted !== undefined) updateData.records_upserted = data.records_upserted;
    if (data.records_skipped !== undefined) updateData.records_skipped = data.records_skipped;
    if (data.records_failed !== undefined) updateData.records_failed = data.records_failed;
    if (data.error) updateData.error = data.error;
    if (data.metadata) updateData.metadata = data.metadata;

    await supabase
      .from('client_sync_runs')
      .update(updateData)
      .eq('id', syncRunId);
  } catch (error) {
    console.error('Failed to update sync run:', error);
  }
}

/**
 * Gets the latest sync run
 */
export async function getLatestSyncRun(): Promise<any | null> {
  if (!isSchedulingDBConfigured() || !isDBValidated()) {
    return null;
  }

  try {
    const supabase = getSchedulingClient();
    const { data, error } = await supabase
      .from('client_sync_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return data;
  } catch (error) {
    console.error('Failed to get latest sync run:', error);
    return null;
  }
}
