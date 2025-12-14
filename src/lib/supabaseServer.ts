import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !serviceRoleKey) {
  console.warn('⚠️ Supabase server credentials not found in environment variables');
}

export const supabaseServer = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

