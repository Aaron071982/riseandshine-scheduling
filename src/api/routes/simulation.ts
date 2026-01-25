/**
 * Simulation Workflow API Routes
 * 
 * Admin endpoints for manual client entry, simulation runs, proposal management,
 * and RBT reopening functionality.
 */

import { Router, Request, Response } from 'express';
import { isDBValidated } from '../../lib/supabaseSched';
import {
  addClient,
  runSimulation,
  getProposals,
  approveProposal,
  rejectProposal,
  deferProposal,
  reopenRBT,
  getPairedClients,
  getRBTs,
} from '../../lib/simulation';
import { getActiveRBTs } from '../../lib/rbts';

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
 * POST /api/admin/simulation/add-client
 * Add a new client manually with geocoding
 */
router.post('/add-client', async (req: Request, res: Response) => {
  try {
    const { name, address, notes } = req.body;

    if (!name || !address) {
      return res.status(400).json({
        error: true,
        message: 'Name and address are required',
      });
    }

    const client = await addClient(name, address, notes);

    res.json({
      success: true,
      client,
    });
  } catch (error) {
    console.error('[API] Error adding client:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Failed to add client',
    });
  }
});

/**
 * POST /api/admin/simulation/run
 * Run simulation to create proposals for unpaired clients
 */
router.post('/run', async (req: Request, res: Response) => {
  try {
    console.log('[API] Simulation run triggered');

    const result = await runSimulation();

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[API] Error running simulation:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Failed to run simulation',
    });
  }
});

/**
 * GET /api/admin/simulation/proposals
 * Get proposals with optional filters
 */
router.get('/proposals', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as 'proposed' | 'approved' | 'rejected' | 'expired' | 'deferred' | undefined;
    const simulation_run_id = req.query.simulation_run_id as string | undefined;

    const proposals = await getProposals({
      status,
      simulation_run_id,
    });

    res.json({
      success: true,
      proposals,
      count: proposals.length,
    });
  } catch (error) {
    console.error('[API] Error fetching proposals:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Failed to fetch proposals',
    });
  }
});

/**
 * POST /api/admin/simulation/approve/:proposal_id
 * Approve a proposal (calls RPC function)
 */
router.post('/approve/:proposal_id', async (req: Request, res: Response) => {
  try {
    const { proposal_id } = req.params;

    if (!proposal_id) {
      return res.status(400).json({
        error: true,
        message: 'Proposal ID is required',
      });
    }

    const result = await approveProposal(proposal_id);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[API] Error approving proposal:', error);
    
    // Provide helpful error messages
    const errorMessage = error instanceof Error ? error.message : 'Failed to approve proposal';
    let statusCode = 500;
    
    if (errorMessage.includes('already has an active pairing')) {
      statusCode = 409; // Conflict
    } else if (errorMessage.includes('not available')) {
      statusCode = 409;
    } else if (errorMessage.includes('not found')) {
      statusCode = 404;
    }

    res.status(statusCode).json({
      error: true,
      message: errorMessage,
    });
  }
});

/**
 * POST /api/admin/simulation/reject/:proposal_id
 * Reject a proposal (calls RPC function)
 */
router.post('/reject/:proposal_id', async (req: Request, res: Response) => {
  try {
    const { proposal_id } = req.params;

    if (!proposal_id) {
      return res.status(400).json({
        error: true,
        message: 'Proposal ID is required',
      });
    }

    const result = await rejectProposal(proposal_id);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[API] Error rejecting proposal:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Failed to reject proposal',
    });
  }
});

/**
 * POST /api/admin/simulation/defer/:proposal_id
 * Defer a proposal (stall for later review)
 */
router.post('/defer/:proposal_id', async (req: Request, res: Response) => {
  try {
    const { proposal_id } = req.params;

    if (!proposal_id) {
      return res.status(400).json({
        error: true,
        message: 'Proposal ID is required',
      });
    }

    const result = await deferProposal(proposal_id);

    res.json({
      success: true,
      proposal: result,
    });
  } catch (error) {
    console.error('[API] Error deferring proposal:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Failed to defer proposal',
    });
  }
});

/**
 * GET /api/admin/simulation/paired
 * Get all paired clients (active pairings only)
 */
router.get('/paired', async (req: Request, res: Response) => {
  try {
    const pairings = await getPairedClients();

    res.json({
      success: true,
      pairings,
      count: pairings.length,
    });
  } catch (error) {
    console.error('[API] Error fetching paired clients:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Failed to fetch paired clients',
    });
  }
});

/**
 * POST /api/admin/rbts/:id/reopen
 * Reopen an RBT (make available again)
 */
router.post('/:id/reopen', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        error: true,
        message: 'RBT ID is required',
      });
    }

    const result = await reopenRBT(id);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[API] Error reopening RBT:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to reopen RBT';
    let statusCode = 500;
    
    if (errorMessage.includes('not found')) {
      statusCode = 404;
    } else if (errorMessage.includes('No active pairings')) {
      statusCode = 400;
    }

    res.status(statusCode).json({
      error: true,
      message: errorMessage,
    });
  }
});

/**
 * GET /api/admin/rbts
 * Get RBTs with optional availability filter
 * Falls back to getActiveRBTs() if no RBTs in simulation table
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const availability_status = req.query.availability_status as 'available' | 'locked' | undefined;

    let rbts = await getRBTs({
      availability_status,
    });

    // If no RBTs found, try getActiveRBTs which has HRM fallback
    if (rbts.length === 0) {
      console.log('[API] No RBTs in simulation table, trying getActiveRBTs with HRM fallback...');
      try {
        const activeRBTs = await getActiveRBTs();
        console.log(`[API] getActiveRBTs returned ${activeRBTs.length} RBTs`);
        
        // Convert to simulation format - only RBTs with zip codes
        if (activeRBTs.length > 0) {
          rbts = activeRBTs
            .filter(rbt => rbt.lat && rbt.lng && rbt.zip && rbt.zip.trim() !== '') // Only RBTs with coordinates AND zip codes
            .map(rbt => ({
              id: rbt.id,
              full_name: rbt.full_name,
              lat: rbt.lat,
              lng: rbt.lng,
              availability_status: 'available' as const,
            }));
        }
        
        console.log(`[API] Final RBT count: ${rbts.length}`);
      } catch (error) {
        console.error('[API] Error calling getActiveRBTs:', error);
      }
    }

    // Get active pairing count for each RBT
    const { getSchedulingClient } = await import('../../lib/supabaseSched');
    const supabase = getSchedulingClient();
    
    const rbtsWithPairings = await Promise.all(
      rbts.map(async (rbt) => {
        const { count } = await supabase
          .from('pairings')
          .select('*', { count: 'exact', head: true })
          .eq('rbt_id', rbt.id)
          .eq('status', 'active');

        return {
          ...rbt,
          active_pairing_count: count || 0,
        };
      })
    );

    res.json({
      success: true,
      rbts: rbtsWithPairings,
      count: rbtsWithPairings.length,
    });
  } catch (error) {
    console.error('[API] Error fetching RBTs:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Failed to fetch RBTs',
    });
  }
});

export default router;
