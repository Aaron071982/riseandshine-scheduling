/**
 * Matching API Routes
 * 
 * Admin endpoints for running matching jobs and viewing status.
 */

import { Router, Request, Response } from 'express';
import { getSchedulingClient, isDBValidated } from '../../lib/supabaseSched';
import { getActiveRBTs } from '../../lib/rbts';
import { loadClients } from '../../lib/clients';
import { matchClientsToRBTs, matchClientsToRBTsWithMetrics } from '../../lib/scheduling/matcher';
import { syncClientsFromCrm, getLatestSyncRun } from '../../lib/scheduling/syncClients';
import { validateCrmDB } from '../../lib/supabaseCrm';
import { randomUUID } from 'crypto';
import { config } from '../../lib/config';

const router = Router();

// Middleware to ensure DB is validated
router.use((req: Request, res: Response, next: Function) => {
  if (!isDBValidated()) {
    return res.status(503).json({
      error: true,
      message: 'Database not validated. Server may be starting up.',
      code: 'DB_NOT_READY',
    });
  }
  next();
});

/**
 * POST /api/admin/run-matching
 * Trigger the matching job and return summary
 * Now includes match run tracking and override awareness
 */
router.post('/run-matching', async (req: Request, res: Response) => {
  try {
    console.log('[API] Run matching triggered via API');
    
    const runId = randomUUID();
    const runStartTime = Date.now();
    
    // Load data
    const rbts = await getActiveRBTs();
    const clients = await loadClients();
    
    if (rbts.length === 0 || clients.length === 0) {
      return res.status(400).json({
        error: true,
        message: `Cannot run matching: ${rbts.length === 0 ? 'No RBTs found' : 'No clients found'}`,
      });
    }
    
    // Create match run record
    const supabase = getSchedulingClient();
    const matchRunId = randomUUID();
    const startedAt = new Date().toISOString();
    
    try {
      await supabase
        .from('match_runs')
        .insert({
          id: matchRunId,
          started_at: startedAt,
          input_clients_count: clients.length,
          input_rbts_count: rbts.length,
        });
    } catch (runError: any) {
      console.warn('Failed to create match run record:', runError);
      // Continue anyway
    }
    
    // Run matching with metrics
    const matchingResult = await matchClientsToRBTsWithMetrics(clients, rbts);
    const matches = matchingResult.matches;
    const runDurationSec = Math.round((Date.now() - runStartTime) / 1000);
    
    // Calculate summary
    const matchedCount = matches.filter(m => m.status === 'matched').length;
    const standbyCount = matches.filter(m => m.status === 'standby').length;
    const noLocationCount = matches.filter(m => m.status === 'no_location').length;
    const needsReviewCount = matches.filter(m => m.needsReview).length;
    const lockedCount = matchingResult.lockedCount;
    const autoCount = matchingResult.autoCount;
    const blockedCount = matchingResult.blockedCount;
    
    // Calculate cache hit rate
    const totalRequests = matchingResult.googleApiCalls + matchingResult.cacheHits;
    const cacheHitRate = totalRequests > 0 
      ? Math.round((matchingResult.cacheHits / totalRequests) * 100 * 100) / 100 
      : 0;
    
    const computedAt = new Date().toISOString();
    
    try {
      // Deactivate old matches
      await supabase
        .from('matches')
        .update({ active: false })
        .eq('active', true);
      
      // Insert new matches
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
        await supabase
          .from('matches')
          .insert(matchesToInsert);
      }
      
      // Update match run record
      await supabase
        .from('match_runs')
        .update({
          ended_at: computedAt,
          matched_count: matchedCount,
          locked_count: lockedCount,
          auto_count: autoCount,
          manual_count: matchingResult.manualCount,
          standby_count: standbyCount,
          no_location_count: noLocationCount,
          blocked_count: blockedCount,
          google_api_calls: matchingResult.googleApiCalls,
          cache_hits: matchingResult.cacheHits,
          cache_hit_rate: cacheHitRate,
          metadata: {
            runId,
            needsReviewCount,
          },
        })
        .eq('id', matchRunId);
      
      // Update scheduling_meta
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
        lockedCount,
        autoCount,
        blockedCount,
      };
      
      await supabase
        .from('scheduling_meta')
        .update({
          last_matching_run_at: computedAt,
          last_matching_summary: summary,
          updated_at: computedAt,
        })
        .eq('id', 1);
    } catch (dbError: any) {
      console.error('Error writing to database:', dbError);
      // Continue anyway - return results even if DB write fails
    }
    
    res.json({
      success: true,
      runId,
      matchRunId,
      generatedAt: computedAt,
      summary: {
        matched: matchedCount,
        locked: lockedCount,
        auto: autoCount,
        blocked: blockedCount,
        standby: standbyCount,
        noLocation: noLocationCount,
        needsReview: needsReviewCount,
        totalClients: matches.length,
        totalRBTs: rbts.length,
        durationSec: runDurationSec,
        googleApiCalls: matchingResult.googleApiCalls,
        cacheHits: matchingResult.cacheHits,
        cacheHitRate,
      },
    });
  } catch (error: any) {
    console.error('Error running matching:', error);
    res.status(500).json({
      error: true,
      message: error.message || 'Failed to run matching job',
    });
  }
});

/**
 * GET /api/admin/matching-status
 * Get last matching run info from scheduling_meta
 */
router.get('/matching-status', async (req: Request, res: Response) => {
  try {
    const supabase = getSchedulingClient();
    
    const { data, error } = await supabase
      .from('scheduling_meta')
      .select('last_matching_run_at, last_matching_summary')
      .eq('id', 1)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching matching status:', error);
      return res.status(500).json({
        error: true,
        message: error.message,
      });
    }
    
    res.json({
      success: true,
      lastRunAt: data?.last_matching_run_at || null,
      summary: data?.last_matching_summary || null,
    });
  } catch (error: any) {
    console.error('Error fetching matching status:', error);
    res.status(500).json({
      error: true,
      message: error.message || 'Failed to fetch matching status',
    });
  }
});

/**
 * GET /api/admin/unmatched
 * Get list of clients with status standby or no_location + reasons
 */
router.get('/unmatched', async (req: Request, res: Response) => {
  try {
    const supabase = getSchedulingClient();
    
    // Get unmatched matches from database
    const { data: unmatchedMatches, error } = await supabase
      .from('matches')
      .select(`
        status,
        reason,
        clients (
          id,
          name,
          status,
          location_borough,
          city,
          state,
          zip,
          lat,
          lng,
          needs_location_verification
        )
      `)
      .in('status', ['standby', 'no_location'])
      .eq('active', true)
      .order('status', { ascending: true })
      .order('clients.name', { ascending: true });
    
    if (error) {
      console.error('Error fetching unmatched clients:', error);
      return res.status(500).json({
        error: true,
        message: error.message,
      });
    }
    
    // Transform to frontend-friendly format
    const unmatched = (unmatchedMatches || []).map((m: any) => ({
      clientId: m.clients?.id,
      clientName: m.clients?.name,
      status: m.status,
      reason: m.reason || 'Unknown',
      location: m.clients?.location_borough || `${m.clients?.city || ''}, ${m.clients?.state || ''}`.trim(),
      needsLocationVerification: m.clients?.needs_location_verification || false,
    }));
    
    res.json({
      success: true,
      count: unmatched.length,
      unmatched,
    });
  } catch (error: any) {
    console.error('Error fetching unmatched clients:', error);
    res.status(500).json({
      error: true,
      message: error.message || 'Failed to fetch unmatched clients',
    });
  }
});

/**
 * POST /api/admin/scheduling/sync-clients
 * 
 * Syncs clients from CRM database to Scheduling DB.
 * Admin-only endpoint (auth not implemented yet - TODO).
 */
router.post('/sync-clients', async (req: Request, res: Response) => {
  try {
    console.log('[API] Client sync triggered via API');
    
    // Validate CRM DB connection first
    try {
      await validateCrmDB();
    } catch (error) {
      return res.status(400).json({
        error: true,
        message: `CRM database validation failed: ${error instanceof Error ? error.message : String(error)}`,
        code: 'CRM_VALIDATION_FAILED',
      });
    }
    
    // Run sync
    const result = await syncClientsFromCrm();
    
    if (!result.success) {
      return res.status(500).json({
        error: true,
        message: 'Sync failed',
        details: result.errors,
        syncRunId: result.syncRunId,
      });
    }
    
    return res.json({
      success: true,
      message: 'Client sync completed successfully',
      recordsUpserted: result.recordsUpserted,
      recordsSkipped: result.recordsSkipped,
      recordsFailed: result.recordsFailed,
      errors: result.errors.length > 0 ? result.errors : undefined,
      syncRunId: result.syncRunId,
    });
    
  } catch (error) {
    console.error('Error in sync-clients endpoint:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/admin/scheduling/sync-clients/status
 * 
 * Gets the status of the latest client sync run.
 */
router.get('/sync-clients/status', async (req: Request, res: Response) => {
  try {
    const latestRun = await getLatestSyncRun();
    
    if (!latestRun) {
      return res.json({
        success: true,
        hasRun: false,
        message: 'No sync runs found',
      });
    }
    
    return res.json({
      success: true,
      hasRun: true,
      syncRun: {
        id: latestRun.id,
        status: latestRun.status,
        startedAt: latestRun.started_at,
        endedAt: latestRun.ended_at,
        recordsUpserted: latestRun.records_upserted,
        recordsSkipped: latestRun.records_skipped,
        recordsFailed: latestRun.records_failed,
        error: latestRun.error,
        metadata: latestRun.metadata,
      },
    });
    
  } catch (error) {
    console.error('Error in sync-clients/status endpoint:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/admin/scheduling/approve
 * 
 * Bulk approve/reject matches
 * Body: { matchIds: [], status: 'APPROVED' | 'REJECTED', notes?, approvedBy? }
 */
router.post('/approve', async (req: Request, res: Response) => {
  try {
    const { matchIds, status, notes, approvedBy } = req.body;

    if (!matchIds || !Array.isArray(matchIds) || matchIds.length === 0) {
      return res.status(400).json({
        error: true,
        message: 'matchIds array is required',
      });
    }

    if (!status || !['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({
        error: true,
        message: 'status must be APPROVED or REJECTED',
      });
    }

    const supabase = getSchedulingClient();
    const approvedAt = new Date().toISOString();

    // Update matches
    const { data: updatedMatches, error: updateError } = await supabase
      .from('matches')
      .update({
        approved: status === 'APPROVED',
        approved_by: approvedBy || 'admin',
        approved_at: status === 'APPROVED' ? approvedAt : null,
      })
      .in('id', matchIds)
      .select();

    if (updateError) {
      console.error('Error approving matches:', updateError);
      return res.status(500).json({
        error: true,
        message: `Failed to approve matches: ${updateError.message}`,
      });
    }

    // Create approval records
    if (updatedMatches && updatedMatches.length > 0) {
      const approvalRecords = updatedMatches.map((match: any) => ({
        match_run_id: match.match_run_id,
        client_id: match.client_id,
        rbt_id: match.rbt_id,
        approved_by: approvedBy || 'admin',
        status,
        notes: notes || null,
      }));

      await supabase
        .from('match_approvals')
        .insert(approvalRecords);
    }

    return res.json({
      success: true,
      message: `${status} ${updatedMatches?.length || 0} matches`,
      count: updatedMatches?.length || 0,
      matches: updatedMatches || [],
    });
  } catch (error) {
    console.error('Error in approve endpoint:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/admin/scheduling/run
 * 
 * Alias for /run-matching (for consistency with plan)
 * Note: This endpoint is available at both /run-matching and /run
 */

export default router;

