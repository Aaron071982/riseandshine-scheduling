/**
 * Match Overrides API Routes
 * 
 * Admin endpoints for managing match overrides (locked assignments, manual assignments, blocked pairs).
 */

import { Router, Request, Response } from 'express';
import { getSchedulingClient, isDBValidated } from '../../lib/supabaseSched';
import {
  getAllOverrides,
  getOverridesForClient,
  getOverridesForRbt,
  createOverride,
  deleteOverride,
  deleteOverrideByPair,
  getOverrideById,
  type CreateOverrideParams,
  type OverrideType,
} from '../../lib/scheduling/overrides';

const router = Router();

// Middleware to ensure database is validated
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
 * GET /api/admin/scheduling/overrides
 * 
 * List all overrides with optional filters
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const type = req.query.type as OverrideType | undefined;
    const clientId = req.query.clientId as string | undefined;
    const rbtId = req.query.rbtId as string | undefined;

    const overrides = await getAllOverrides({
      type,
      clientId,
      rbtId,
    });

    return res.json({
      success: true,
      count: overrides.length,
      overrides,
    });
  } catch (error) {
    console.error('Error fetching overrides:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/admin/scheduling/overrides/client/:clientId
 * 
 * Get all overrides for a specific client
 */
router.get('/client/:clientId', async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const overrides = await getOverridesForClient(clientId);

    return res.json({
      success: true,
      count: overrides.length,
      overrides,
    });
  } catch (error) {
    console.error('Error fetching client overrides:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/admin/scheduling/overrides/rbt/:rbtId
 * 
 * Get all overrides for a specific RBT
 */
router.get('/rbt/:rbtId', async (req: Request, res: Response) => {
  try {
    const { rbtId } = req.params;
    const overrides = await getOverridesForRbt(rbtId);

    return res.json({
      success: true,
      count: overrides.length,
      overrides,
    });
  } catch (error) {
    console.error('Error fetching RBT overrides:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/admin/scheduling/overrides
 * 
 * Create a new override
 * Body: { clientId, rbtId, type, createdBy?, notes?, effectiveFrom?, effectiveTo? }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { clientId, rbtId, type, createdBy, notes, effectiveFrom, effectiveTo } = req.body;

    // Validation
    if (!clientId || !rbtId || !type) {
      return res.status(400).json({
        error: true,
        message: 'Missing required fields: clientId, rbtId, type',
      });
    }

    if (!['LOCKED_ASSIGNMENT', 'MANUAL_ASSIGNMENT', 'BLOCK_PAIR'].includes(type)) {
      return res.status(400).json({
        error: true,
        message: 'Invalid type. Must be LOCKED_ASSIGNMENT, MANUAL_ASSIGNMENT, or BLOCK_PAIR',
      });
    }

    const params: CreateOverrideParams = {
      clientId,
      rbtId,
      type,
      createdBy: createdBy || 'admin',
      notes,
      effectiveFrom,
      effectiveTo,
    };

    const override = await createOverride(params);

    if (!override) {
      return res.status(500).json({
        error: true,
        message: 'Failed to create override',
      });
    }

    return res.json({
      success: true,
      message: 'Override created successfully',
      override,
    });
  } catch (error) {
    console.error('Error creating override:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/admin/scheduling/overrides/:id
 * 
 * Delete an override by ID
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const success = await deleteOverride(id);

    if (!success) {
      return res.status(404).json({
        error: true,
        message: 'Override not found or could not be deleted',
      });
    }

    return res.json({
      success: true,
      message: 'Override deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting override:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/admin/scheduling/overrides/pair/:clientId/:rbtId
 * 
 * Delete an override by client and RBT IDs
 */
router.delete('/pair/:clientId/:rbtId', async (req: Request, res: Response) => {
  try {
    const { clientId, rbtId } = req.params;
    const success = await deleteOverrideByPair(clientId, rbtId);

    if (!success) {
      return res.status(404).json({
        error: true,
        message: 'Override not found or could not be deleted',
      });
    }

    return res.json({
      success: true,
      message: 'Override deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting override by pair:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/admin/scheduling/overrides/:clientId/:rbtId
 * 
 * Get a specific override by client and RBT IDs
 */
router.get('/:clientId/:rbtId', async (req: Request, res: Response) => {
  try {
    const { clientId, rbtId } = req.params;
    const override = await getOverrideById(clientId, rbtId);

    if (!override) {
      return res.status(404).json({
        error: true,
        message: 'Override not found',
      });
    }

    return res.json({
      success: true,
      override,
    });
  } catch (error) {
    console.error('Error fetching override:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
