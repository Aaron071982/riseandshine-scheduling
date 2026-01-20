/**
 * API Server for Scheduling AI
 * 
 * Provides secure endpoints for operations that require SERVICE_ROLE key.
 * Manual pin updates, location verification, etc. go through here.
 */

// CRITICAL: Load environment variables FIRST, before any other imports
import path from 'path';
import dotenv from 'dotenv';

// Force load from project root with absolute path
const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

// Debug: Confirm variables are loaded
console.log('ENV CHECK:', {
  SCHED_URL: process.env.SUPABASE_SCHED_URL ? `${process.env.SUPABASE_SCHED_URL.substring(0, 30)}...` : 'NOT SET',
  SCHED_REF: process.env.SUPABASE_SCHED_PROJECT_REF || 'NOT SET',
  HAS_ROLE: !!process.env.SUPABASE_SCHED_SERVICE_ROLE_KEY,
  ENV_PATH: envPath,
});

// Now import everything else (they will use the env vars we just loaded)
import express from 'express';
import cors from 'cors';

import { validateSchedulingDB, isSchedulingDBConfigured, getSchedulingDBUrl, getSchedulingClient } from '../lib/supabaseSched';
import locationRoutes from './routes/location';
import matchesRoutes from './routes/matches';
import matchingRoutes from './routes/matching';
import overridesRoutes from './routes/overrides';
import simulationRoutes from './routes/simulation';
import { startScheduler } from '../jobs/scheduler';

const app = express();
const PORT = process.env.API_PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    dbConfigured: isSchedulingDBConfigured(),
    dbUrl: getSchedulingDBUrl(),
  });
});

// Mount routes
app.use('/api/location', locationRoutes);
app.use('/api/admin/matches', matchesRoutes);
app.use('/api/admin/matching', matchingRoutes);
app.use('/api/admin/scheduling/overrides', overridesRoutes);
app.use('/api/admin/simulation', simulationRoutes);
app.use('/api/admin/rbts', simulationRoutes); // RBT management routes (reopen)
app.use('/api/rbt', matchesRoutes); // RBT-specific routes

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('API Error:', err);
  res.status(500).json({
    error: true,
    message: err.message || 'Internal server error',
  });
});

// Start server
async function startServer() {
  console.log('🚀 Starting Scheduling AI API Server\n');
  
  // Validate database connection BEFORE accepting requests
  if (isSchedulingDBConfigured()) {
    console.log(`   Scheduling DB: ${getSchedulingDBUrl()}`);
    try {
      await validateSchedulingDB();
    } catch (error) {
      console.error('❌ FATAL: Database validation failed. Server will not start.');
      process.exit(1);
    }
  } else {
    console.error('❌ FATAL: Scheduling DB not configured. Set SUPABASE_SCHED_* environment variables.');
    process.exit(1);
  }
  
  app.listen(PORT, async () => {
    console.log(`\n✅ API Server running on http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/api/health`);
    console.log(`   Location API: http://localhost:${PORT}/api/location/*`);
    console.log(`   Matches API: http://localhost:${PORT}/api/admin/matches/*`);
    console.log(`   Matching API: http://localhost:${PORT}/api/admin/matching/*`);
    console.log(`   Overrides API: http://localhost:${PORT}/api/admin/scheduling/overrides/*`);
    console.log(`   Simulation API: http://localhost:${PORT}/api/admin/simulation/*`);
    console.log(`   RBTs API: http://localhost:${PORT}/api/admin/rbts/*`);
    
    // Start scheduler (with guard against double-start in hot reload)
    // Use a global flag to prevent duplicate schedulers
    if (!(global as any).__SCHEDULER_STARTED) {
      (global as any).__SCHEDULER_STARTED = true;
      // Small delay to ensure DB is ready
      setTimeout(() => {
        startScheduler().catch(err => {
          console.error('Failed to start scheduler:', err);
        });
      }, 2000);
    }
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;

