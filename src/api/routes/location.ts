/**
 * Location API Routes
 * 
 * Secure endpoints for location management using SERVICE_ROLE key.
 * Manual pin updates, location verification, etc.
 * 
 * SECURITY: These routes use the SERVICE_ROLE key which bypasses RLS.
 * Only expose these through the Node API server, never directly to frontend.
 */

import { Router, Request, Response } from 'express';
import { getSchedulingClient, isDBValidated } from '../../lib/supabaseSched';
import { GeocodePrecision, GeocodeSource } from '../../lib/geocoding/geocode';

const router = Router();

// Types for request bodies
interface UpdateLocationBody {
  entityType: 'client' | 'rbt';
  entityId: string;
  lat: number;
  lng: number;
  source?: GeocodeSource;
  notes?: string;
}

interface BatchGeocodeBody {
  entityType: 'client' | 'rbt';
  entityIds: string[];
}

/**
 * Middleware to ensure database is validated before any operations
 */
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
 * POST /api/location/update
 * 
 * Updates the location (lat/lng) for a client or RBT.
 * This is the ONLY way to update locations - no direct anon updates.
 * 
 * Body:
 *   - entityType: 'client' | 'rbt'
 *   - entityId: string
 *   - lat: number
 *   - lng: number
 *   - source?: GeocodeSource (defaults to 'manual_pin')
 *   - notes?: string
 */
router.post('/update', async (req: Request, res: Response) => {
  try {
    const body = req.body as UpdateLocationBody;
    
    // Validate required fields
    if (!body.entityType || !body.entityId || body.lat === undefined || body.lng === undefined) {
      return res.status(400).json({
        error: true,
        message: 'Missing required fields: entityType, entityId, lat, lng',
      });
    }
    
    // Validate entityType
    if (body.entityType !== 'client' && body.entityType !== 'rbt') {
      return res.status(400).json({
        error: true,
        message: 'entityType must be "client" or "rbt"',
      });
    }
    
    // Validate coordinates are reasonable
    if (body.lat < -90 || body.lat > 90 || body.lng < -180 || body.lng > 180) {
      return res.status(400).json({
        error: true,
        message: 'Invalid coordinates. Lat must be -90 to 90, lng must be -180 to 180.',
      });
    }
    
    // Validate coordinates are in continental US (loose check)
    const isInUS = body.lat >= 24 && body.lat <= 50 && body.lng >= -125 && body.lng <= -66;
    if (!isInUS) {
      return res.status(400).json({
        error: true,
        message: 'Coordinates appear to be outside continental US. Please verify.',
        warning: true,
      });
    }
    
    const supabase = getSchedulingClient();
    const tableName = body.entityType === 'client' ? 'clients' : 'rbt_profiles';
    
    // Prepare update data
    const updateData = {
      lat: body.lat,
      lng: body.lng,
      geocode_precision: 'ROOFTOP' as GeocodePrecision, // Manual pin = highest precision
      geocode_confidence: 1.0, // Manual = full confidence
      geocode_source: (body.source || 'manual_pin') as GeocodeSource,
      geocode_updated_at: new Date().toISOString(),
    };
    
    // Update the record
    const { data, error } = await supabase
      .from(tableName)
      .update(updateData)
      .eq('id', body.entityId)
      .select()
      .single();
    
    if (error) {
      console.error(`Error updating ${body.entityType} location:`, error);
      return res.status(500).json({
        error: true,
        message: `Failed to update location: ${error.message}`,
        code: error.code,
      });
    }
    
    if (!data) {
      return res.status(404).json({
        error: true,
        message: `${body.entityType} with ID ${body.entityId} not found`,
      });
    }
    
    console.log(`✅ Updated ${body.entityType} ${body.entityId} location to (${body.lat}, ${body.lng})`);
    
    // Invalidate travel time cache for this entity
    await invalidateTravelTimeCache(supabase, body.entityType, body.entityId);
    
    return res.json({
      success: true,
      message: `Location updated successfully`,
      data: {
        entityType: body.entityType,
        entityId: body.entityId,
        lat: body.lat,
        lng: body.lng,
        precision: 'ROOFTOP',
        confidence: 1.0,
        source: body.source || 'manual_pin',
        updatedAt: updateData.geocode_updated_at,
      },
    });
    
  } catch (error) {
    console.error('Error in location update:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/location/:entityType/:entityId
 * 
 * Gets the current location data for a client or RBT.
 */
router.get('/:entityType/:entityId', async (req: Request, res: Response) => {
  try {
    const { entityType, entityId } = req.params;
    
    if (entityType !== 'client' && entityType !== 'rbt') {
      return res.status(400).json({
        error: true,
        message: 'entityType must be "client" or "rbt"',
      });
    }
    
    const supabase = getSchedulingClient();
    const tableName = entityType === 'client' ? 'clients' : 'rbt_profiles';
    
    const { data, error } = await supabase
      .from(tableName)
      .select('id, lat, lng, geocode_precision, geocode_confidence, geocode_source, geocode_updated_at')
      .eq('id', entityId)
      .single();
    
    if (error) {
      console.error(`Error fetching ${entityType} location:`, error);
      return res.status(500).json({
        error: true,
        message: `Failed to fetch location: ${error.message}`,
      });
    }
    
    if (!data) {
      return res.status(404).json({
        error: true,
        message: `${entityType} with ID ${entityId} not found`,
      });
    }
    
    return res.json({
      success: true,
      data: {
        entityType,
        entityId,
        lat: data.lat,
        lng: data.lng,
        precision: data.geocode_precision,
        confidence: data.geocode_confidence,
        source: data.geocode_source,
        updatedAt: data.geocode_updated_at,
      },
    });
    
  } catch (error) {
    console.error('Error fetching location:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/location/verify
 * 
 * Marks a location as verified without changing coordinates.
 */
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { entityType, entityId } = req.body;
    
    if (!entityType || !entityId) {
      return res.status(400).json({
        error: true,
        message: 'Missing required fields: entityType, entityId',
      });
    }
    
    if (entityType !== 'client' && entityType !== 'rbt') {
      return res.status(400).json({
        error: true,
        message: 'entityType must be "client" or "rbt"',
      });
    }
    
    const supabase = getSchedulingClient();
    const tableName = entityType === 'client' ? 'clients' : 'rbt_profiles';
    
    // Just update the confidence and source to indicate verification
    const { data, error } = await supabase
      .from(tableName)
      .update({
        geocode_confidence: 1.0,
        geocode_source: 'manual_pin' as GeocodeSource,
        geocode_updated_at: new Date().toISOString(),
      })
      .eq('id', entityId)
      .select('id, lat, lng')
      .single();
    
    if (error) {
      console.error(`Error verifying ${entityType} location:`, error);
      return res.status(500).json({
        error: true,
        message: `Failed to verify location: ${error.message}`,
      });
    }
    
    if (!data) {
      return res.status(404).json({
        error: true,
        message: `${entityType} with ID ${entityId} not found`,
      });
    }
    
    console.log(`✅ Verified ${entityType} ${entityId} location`);
    
    return res.json({
      success: true,
      message: 'Location verified successfully',
      data: {
        entityType,
        entityId,
        lat: data.lat,
        lng: data.lng,
      },
    });
    
  } catch (error) {
    console.error('Error verifying location:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Helper: Invalidate travel time cache entries involving this entity
 */
async function invalidateTravelTimeCache(
  supabase: ReturnType<typeof getSchedulingClient>,
  entityType: 'client' | 'rbt',
  entityId: string
): Promise<void> {
  try {
    // Delete cache entries where this entity is origin or destination
    const idField = entityType === 'client' ? 'dest_id' : 'origin_id';
    
    const { error } = await supabase
      .from('travel_time_cache')
      .delete()
      .or(`origin_id.eq.${entityId},dest_id.eq.${entityId}`);
    
    if (error) {
      console.warn(`Warning: Could not invalidate travel time cache for ${entityType} ${entityId}:`, error.message);
    } else {
      console.log(`   Invalidated travel time cache for ${entityType} ${entityId}`);
    }
  } catch (e) {
    console.warn('Warning: Error invalidating travel time cache:', e);
  }
}

export default router;

