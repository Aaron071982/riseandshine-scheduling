/**
 * Isolated Supabase client for CRM Database
 * 
 * CRITICAL: This client connects ONLY to the CRM database (read-only).
 * It is completely separate from HRM and Scheduling databases to prevent
 * accidental schema changes or data corruption.
 * 
 * VALIDATION REQUIREMENTS:
 * 1. Check for known table (assumes 'clients' table exists in CRM)
 * 2. CRM_SUPABASE_URL must be configured
 * 3. Validation MUST run before any queries - hard fail on validation failure
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Load dotenv if not already loaded
if (!process.env.CRM_SUPABASE_URL && !process.env.CRM_SUPABASE_SERVICE_ROLE_KEY) {
  try {
    const dotenv = require('dotenv');
    dotenv.config();
  } catch (e) {
    // dotenv not available or already loaded - that's fine
  }
}

// CRM-specific environment variables
const CRM_URL = process.env.CRM_SUPABASE_URL || '';
const CRM_SERVICE_KEY = process.env.CRM_SUPABASE_SERVICE_ROLE_KEY || '';
const CRM_ANON_KEY = process.env.CRM_SUPABASE_ANON_KEY || '';

// Track validation state - NO QUERIES until validated
let isValidated = false;
let validationError: Error | null = null;

/**
 * Check if CRM database is configured
 */
export function isCrmDBConfigured(): boolean {
  return !!(CRM_URL && (CRM_SERVICE_KEY || CRM_ANON_KEY));
}

/**
 * Create the CRM Supabase client - but DO NOT use until validated
 */
function createCrmClient(): SupabaseClient {
  if (!CRM_URL) {
    throw new Error('FATAL: CRM_SUPABASE_URL not configured');
  }
  
  const key = CRM_SERVICE_KEY || CRM_ANON_KEY;
  if (!key) {
    throw new Error('FATAL: CRM_SUPABASE_SERVICE_ROLE_KEY or CRM_SUPABASE_ANON_KEY not configured');
  }
  
  return createClient(CRM_URL, key, {
    auth: { persistSession: false }
  });
}

// Create client instance (lazy - will throw on first use if not configured)
let _supabaseCrm: SupabaseClient | null = null;

/**
 * Get the CRM database client
 * THROWS if not validated or validation failed
 */
export function getCrmClient(): SupabaseClient {
  if (validationError) {
    throw validationError;
  }
  
  if (!isValidated) {
    throw new Error(
      'FATAL: CRM database not validated. ' +
      'Call validateCrmDB() before any queries.'
    );
  }
  
  if (!_supabaseCrm) {
    _supabaseCrm = createCrmClient();
  }
  
  return _supabaseCrm;
}

/**
 * Validates that we're connected to the CRM database.
 * 
 * MUST be called before ANY Supabase queries.
 * CRASHES HARD on failure - this is intentional to prevent data corruption.
 * 
 * Checks:
 * 1. CRM_SUPABASE_URL is configured
 * 2. clients table exists (or crm_meta table if available)
 * 
 * @throws Error if validation fails
 */
export async function validateCrmDB(): Promise<void> {
  // Already validated successfully
  if (isValidated) {
    return;
  }
  
  // Already failed - throw cached error
  if (validationError) {
    throw validationError;
  }
  
  console.log('🔒 Validating CRM Database connection...');
  
  try {
    // Check 1: Environment variables configured
    if (!isCrmDBConfigured()) {
      throw new Error(
        'FATAL: CRM DB not configured. ' +
        'Set CRM_SUPABASE_URL and CRM_SUPABASE_SERVICE_ROLE_KEY environment variables.'
      );
    }
    
    // Create temporary client for validation
    const tempClient = createCrmClient();
    
    // Check 2: Try to query clients table (assumed to exist in CRM)
    // If crm_meta table exists, check that first (similar to scheduling_meta)
    let tableExists = false;
    
    // First, try crm_meta table if it exists (optional safety marker)
    const { data: metaData, error: metaError } = await tempClient
      .from('crm_meta')
      .select('project_name')
      .eq('id', 1)
      .maybeSingle();
    
    if (!metaError && metaData) {
      console.log(`   ✓ crm_meta table found (project: ${metaData.project_name || 'unknown'})`);
      tableExists = true;
    } else {
      // Fallback: Check if clients table exists by trying a simple query
      const { error: clientsError } = await tempClient
        .from('clients')
        .select('id')
        .limit(1)
        .maybeSingle();
      
      if (clientsError) {
        if (clientsError.code === '42P01' || clientsError.message.includes('does not exist')) {
          throw new Error(
            `FATAL: clients table not found in CRM database.\n` +
            `  Verify CRM_SUPABASE_URL points to the correct CRM database.\n` +
            `  Expected table: 'clients'`
          );
        }
        throw new Error(`FATAL: Database query failed: ${clientsError.message}`);
      }
      
      tableExists = true;
      console.log('   ✓ clients table found');
    }
    
    if (!tableExists) {
      throw new Error('FATAL: Could not validate CRM database - no known tables found');
    }
    
    // All checks passed
    isValidated = true;
    _supabaseCrm = tempClient;
    
    console.log('✅ CRM Database validated successfully\n');
    
  } catch (error) {
    // Cache the error and rethrow
    validationError = error instanceof Error ? error : new Error(String(error));
    
    console.error('\n' + '='.repeat(70));
    console.error('CRM DATABASE VALIDATION FAILED');
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
export function _resetCrmValidation(): void {
  isValidated = false;
  validationError = null;
  _supabaseCrm = null;
}

/**
 * Check if CRM database has been validated
 */
export function isCrmDBValidated(): boolean {
  return isValidated;
}

/**
 * Get the CRM database URL (masked for logging)
 */
export function getCrmDBUrl(): string {
  if (!CRM_URL) return 'NOT CONFIGURED';
  try {
    const url = new URL(CRM_URL);
    return `${url.protocol}//${url.hostname.substring(0, 12)}...`;
  } catch {
    return 'INVALID URL';
  }
}

export default getCrmClient;
