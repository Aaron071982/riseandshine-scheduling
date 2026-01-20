/**
 * Isolated Supabase client for Scheduling AI
 * 
 * CRITICAL: This client connects ONLY to the Scheduling database.
 * It is completely separate from the HRM database to prevent
 * accidental schema changes or data corruption.
 * 
 * VALIDATION REQUIREMENTS:
 * 1. scheduling_meta table must exist with project_name='scheduling-ai'
 * 2. SUPABASE_SCHED_URL must contain SUPABASE_SCHED_PROJECT_REF
 * 3. Validation MUST run before any queries - crash hard on failure
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// NOTE: dotenv should be loaded by the entry point (e.g., server.ts or index.ts)
// We only load here if env vars aren't already set (for backwards compatibility)
if (!process.env.SUPABASE_SCHED_URL && !process.env.SUPABASE_SCHED_ANON_KEY) {
  try {
    const dotenv = require('dotenv');
    dotenv.config();
  } catch (e) {
    // dotenv not available or already loaded - that's fine
  }
}

// Scheduling-specific environment variables
const SCHED_URL = process.env.SUPABASE_SCHED_URL || '';
const SCHED_ANON_KEY = process.env.SUPABASE_SCHED_ANON_KEY || '';
const SCHED_SERVICE_KEY = process.env.SUPABASE_SCHED_SERVICE_ROLE_KEY || '';
const SCHED_PROJECT_REF = process.env.SUPABASE_SCHED_PROJECT_REF || '';

// Track validation state - NO QUERIES until validated
let isValidated = false;
let validationError: Error | null = null;

/**
 * Check if scheduling database is configured
 */
export function isSchedulingDBConfigured(): boolean {
  return !!(SCHED_URL && (SCHED_SERVICE_KEY || SCHED_ANON_KEY));
}

/**
 * Extract project reference from Supabase URL
 */
function extractProjectRef(url: string): string | null {
  // URL format: https://<project-ref>.supabase.co
  const match = url.match(/https:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return match ? match[1] : null;
}

/**
 * Create the Supabase client - but DO NOT use until validated
 */
function createSchedulingClient(): SupabaseClient {
  if (!SCHED_URL) {
    throw new Error('FATAL: SUPABASE_SCHED_URL not configured');
  }
  
  const key = SCHED_SERVICE_KEY || SCHED_ANON_KEY;
  if (!key) {
    throw new Error('FATAL: SUPABASE_SCHED_SERVICE_ROLE_KEY or SUPABASE_SCHED_ANON_KEY not configured');
  }
  
  return createClient(SCHED_URL, key, {
    auth: { persistSession: false }
  });
}

// Create client instance (lazy - will throw on first use if not configured)
let _supabaseSched: SupabaseClient | null = null;

/**
 * Get the scheduling database client
 * THROWS if not validated or validation failed
 */
export function getSchedulingClient(): SupabaseClient {
  if (validationError) {
    throw validationError;
  }
  
  if (!isValidated) {
    throw new Error(
      'FATAL: Scheduling database not validated. ' +
      'Call validateSchedulingDB() before any queries.'
    );
  }
  
  if (!_supabaseSched) {
    _supabaseSched = createSchedulingClient();
  }
  
  return _supabaseSched;
}

/**
 * Legacy export for compatibility - but will throw if not validated
 */
export const supabaseSched = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return getSchedulingClient()[prop as keyof SupabaseClient];
  }
});

/**
 * Scheduling database client (anon key - for client-side operations)
 * Use this for frontend operations with RLS
 */
export function getSchedulingClientAnon(): SupabaseClient {
  if (!SCHED_URL || !SCHED_ANON_KEY) {
    throw new Error('FATAL: SUPABASE_SCHED_URL or SUPABASE_SCHED_ANON_KEY not configured');
  }
  
  return createClient(SCHED_URL, SCHED_ANON_KEY, {
    auth: { persistSession: false }
  });
}

/**
 * Validates that we're connected to the correct Scheduling database.
 * 
 * MUST be called before ANY Supabase queries.
 * CRASHES HARD on failure - this is intentional to prevent data corruption.
 * 
 * Checks:
 * 1. SUPABASE_SCHED_URL contains SUPABASE_SCHED_PROJECT_REF (if provided)
 * 2. scheduling_meta table exists
 * 3. project_name = 'scheduling-ai'
 * 
 * @throws Error if validation fails
 */
export async function validateSchedulingDB(): Promise<void> {
  // Already validated successfully
  if (isValidated) {
    return;
  }
  
  // Already failed - throw cached error
  if (validationError) {
    throw validationError;
  }
  
  console.log('🔒 Validating Scheduling Database connection...');
  
  try {
    // Check 1: Environment variables configured
    if (!isSchedulingDBConfigured()) {
      throw new Error(
        'FATAL: Scheduling DB not configured. ' +
        'Set SUPABASE_SCHED_URL and SUPABASE_SCHED_SERVICE_ROLE_KEY environment variables.'
      );
    }
    
    // Check 2: Project reference matches URL (if PROJECT_REF is provided)
    if (SCHED_PROJECT_REF) {
      const urlProjectRef = extractProjectRef(SCHED_URL);
      if (!urlProjectRef) {
        throw new Error(
          `FATAL: Could not extract project reference from SUPABASE_SCHED_URL: ${SCHED_URL}`
        );
      }
      
      if (urlProjectRef.toLowerCase() !== SCHED_PROJECT_REF.toLowerCase()) {
        throw new Error(
          `FATAL: Project reference mismatch!\n` +
          `  SUPABASE_SCHED_URL contains: ${urlProjectRef}\n` +
          `  SUPABASE_SCHED_PROJECT_REF: ${SCHED_PROJECT_REF}\n` +
          `  These must match to prevent connecting to wrong database.`
        );
      }
      console.log(`   ✓ Project reference verified: ${urlProjectRef}`);
    } else {
      console.log('   ⚠ SUPABASE_SCHED_PROJECT_REF not set - skipping URL verification');
    }
    
    // Create temporary client for validation
    const tempClient = createSchedulingClient();
    
    // Check 3: scheduling_meta table exists and has correct project_name
    const { data, error } = await tempClient
      .from('scheduling_meta')
      .select('project_name')
      .eq('id', 1)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116' || error.code === '42P01' || error.message.includes('does not exist')) {
        throw new Error(
          `FATAL: scheduling_meta table not found in database.\n` +
          `  Run the schema setup SQL first:\n` +
          `  sql/001_scheduling_schema.sql\n` +
          `  This table is required to verify correct database connection.`
        );
      }
      throw new Error(`FATAL: Database query failed: ${error.message}`);
    }
    
    // Check 4: project_name must be 'scheduling-ai'
    if (!data || data.project_name !== 'scheduling-ai') {
      throw new Error(
        `FATAL: Wrong database!\n` +
        `  Expected scheduling_meta.project_name = 'scheduling-ai'\n` +
        `  Got: '${data?.project_name || 'null'}'\n` +
        `  Check SUPABASE_SCHED_* environment variables point to the correct project.`
      );
    }
    
    console.log('   ✓ scheduling_meta table verified');
    console.log('   ✓ project_name = "scheduling-ai"');
    
    // All checks passed
    isValidated = true;
    _supabaseSched = tempClient;
    
    console.log('✅ Scheduling Database validated successfully\n');
    
  } catch (error) {
    // Cache the error and rethrow
    validationError = error instanceof Error ? error : new Error(String(error));
    
    console.error('\n' + '='.repeat(70));
    console.error('SCHEDULING DATABASE VALIDATION FAILED');
    console.error('='.repeat(70));
    console.error(validationError.message);
    console.error('='.repeat(70) + '\n');
    
    // Crash hard - this is intentional
    throw validationError;
  }
}

/**
 * Reset validation state (for testing only)
 */
export function _resetValidation(): void {
  isValidated = false;
  validationError = null;
  _supabaseSched = null;
}

/**
 * Check if database has been validated
 */
export function isDBValidated(): boolean {
  return isValidated;
}

/**
 * Get the scheduling database URL (masked for logging)
 */
export function getSchedulingDBUrl(): string {
  if (!SCHED_URL) return 'NOT CONFIGURED';
  try {
    const url = new URL(SCHED_URL);
    return `${url.protocol}//${url.hostname.substring(0, 12)}...`;
  } catch {
    return 'INVALID URL';
  }
}

export default supabaseSched;
