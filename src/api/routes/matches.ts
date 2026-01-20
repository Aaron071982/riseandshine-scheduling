/**
 * Match Suggestions API Routes
 * 
 * Admin endpoints for viewing and managing match suggestions.
 */

import { Router, Request, Response } from 'express';
import { getSchedulingClient, isDBValidated } from '../../lib/supabaseSched';
import { suggestMatches } from '../../lib/scheduling/suggestMatches';

const router = Router();

// Middleware to ensure database is validated
function requireValidatedDB(req: Request, res: Response, next: Function) {
  if (!isDBValidated()) {
    return res.status(503).json({
      error: true,
      message: 'Database not validated. Server may be starting up.',
      code: 'DB_NOT_READY',
    });
  }
  next();
}

router.use(requireValidatedDB);

/**
 * GET /api/admin/matches/pending
 * 
 * Get all pending match suggestions with RBT and Client details.
 */
router.get('/pending', async (req: Request, res: Response) => {
  try {
    const supabase = getSchedulingClient();
    
    const { data: suggestions, error } = await supabase
      .from('match_suggestions')
      .select(`
        *,
        rbt_profiles (
          id,
          first_name,
          last_name,
          full_name,
          email,
          phone,
          city,
          state,
          zip_code,
          transport_mode,
          lat,
          lng,
          geocode_precision
        ),
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
          geocode_precision,
          needs_location_verification
        )
      `)
      .eq('status', 'PENDING')
      .order('score', { ascending: false })
      .limit(100);
    
    if (error) {
      console.error('Error fetching pending matches:', error);
      return res.status(500).json({
        error: true,
        message: `Failed to fetch pending matches: ${error.message}`,
      });
    }
    
    return res.json({
      success: true,
      count: suggestions?.length || 0,
      matches: suggestions || [],
    });
    
  } catch (error) {
    console.error('Error in GET /pending:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/admin/matches/all
 * 
 * Get all match suggestions (pending, approved, rejected).
 */
router.get('/all', async (req: Request, res: Response) => {
  try {
    const supabase = getSchedulingClient();
    const status = req.query.status as string | undefined;
    
    let query = supabase
      .from('match_suggestions')
      .select(`
        *,
        rbt_profiles (
          id,
          first_name,
          last_name,
          full_name,
          email,
          phone,
          city,
          state,
          zip_code,
          transport_mode,
          lat,
          lng,
          geocode_precision
        ),
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
          geocode_precision,
          needs_location_verification
        )
      `)
      .order('score', { ascending: false })
      .limit(200);
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data: suggestions, error } = await query;
    
    if (error) {
      console.error('Error fetching matches:', error);
      return res.status(500).json({
        error: true,
        message: `Failed to fetch matches: ${error.message}`,
      });
    }
    
    return res.json({
      success: true,
      count: suggestions?.length || 0,
      matches: suggestions || [],
    });
    
  } catch (error) {
    console.error('Error in GET /all:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/admin/matches/:id/approve
 * 
 * Approve a match suggestion.
 */
router.post('/:id/approve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const decidedBy = req.body.decidedBy || 'admin'; // Could be user ID from auth
    
    const supabase = getSchedulingClient();
    
    const { data, error } = await supabase
      .from('match_suggestions')
      .update({
        status: 'APPROVED',
        decided_at: new Date().toISOString(),
        decided_by: decidedBy,
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      console.error('Error approving match:', error);
      return res.status(500).json({
        error: true,
        message: `Failed to approve match: ${error.message}`,
      });
    }
    
    if (!data) {
      return res.status(404).json({
        error: true,
        message: 'Match suggestion not found',
      });
    }
    
    console.log(`✅ Approved match suggestion ${id}`);
    
    return res.json({
      success: true,
      message: 'Match approved successfully',
      match: data,
    });
    
  } catch (error) {
    console.error('Error in POST /approve:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/admin/matches/:id/reject
 * 
 * Reject a match suggestion.
 */
router.post('/:id/reject', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const decidedBy = req.body.decidedBy || 'admin';
    const reason = req.body.reason;
    
    const supabase = getSchedulingClient();
    
    const { data, error } = await supabase
      .from('match_suggestions')
      .update({
        status: 'REJECTED',
        decided_at: new Date().toISOString(),
        decided_by: decidedBy,
        review_reason: reason || 'Rejected by admin',
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      console.error('Error rejecting match:', error);
      return res.status(500).json({
        error: true,
        message: `Failed to reject match: ${error.message}`,
      });
    }
    
    if (!data) {
      return res.status(404).json({
        error: true,
        message: 'Match suggestion not found',
      });
    }
    
    console.log(`❌ Rejected match suggestion ${id}`);
    
    return res.json({
      success: true,
      message: 'Match rejected successfully',
      match: data,
    });
    
  } catch (error) {
    console.error('Error in POST /reject:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/admin/matching/suggest
 * 
 * Trigger match suggestion generation.
 */
router.post('/suggest', async (req: Request, res: Response) => {
  try {
    console.log('🔄 Triggering match suggestion generation via API...');
    
    const maxPerRbt = parseInt(req.body.maxPerRbt || '10', 10);
    const result = await suggestMatches(maxPerRbt);
    
    return res.json({
      success: true,
      message: `Generated ${result.total} match suggestions`,
      total: result.total,
    });
    
  } catch (error) {
    console.error('Error generating suggestions:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/rbt/:rbtId/matches
 * 
 * Get all matches (pending/approved) for a specific RBT.
 */
router.get('/rbt/:rbtId', async (req: Request, res: Response) => {
  try {
    const { rbtId } = req.params;
    const supabase = getSchedulingClient();
    
    const { data: matches, error } = await supabase
      .from('match_suggestions')
      .select(`
        *,
        clients (
          id,
          name,
          status,
          location_borough,
          city,
          state,
          zip,
          lat,
          lng
        )
      `)
      .eq('rbt_id', rbtId)
      .in('status', ['PENDING', 'APPROVED'])
      .order('score', { ascending: false });
    
    if (error) {
      console.error('Error fetching RBT matches:', error);
      return res.status(500).json({
        error: true,
        message: `Failed to fetch RBT matches: ${error.message}`,
      });
    }
    
    return res.json({
      success: true,
      count: matches?.length || 0,
      matches: matches || [],
    });
    
  } catch (error) {
    console.error('Error in GET /rbt/:rbtId:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;

