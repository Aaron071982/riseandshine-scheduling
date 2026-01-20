#!/usr/bin/env node
/**
 * Debug script to check environment variables
 * Shows what's loaded from .env (masked for security)
 */

const path = require('path');
const dotenv = require('dotenv');

// Load .env
const envPath = path.resolve(process.cwd(), '.env');
const result = dotenv.config({ path: envPath });

console.log('📋 Environment Variables Check\n');
console.log('ENV file path:', envPath);
console.log('ENV file exists:', require('fs').existsSync(envPath));
console.log('');

if (result.error) {
  console.error('❌ Error loading .env:', result.error);
  process.exit(1);
}

// Check each required variable
const vars = {
  'SUPABASE_SCHED_URL': process.env.SUPABASE_SCHED_URL,
  'SUPABASE_SCHED_ANON_KEY': process.env.SUPABASE_SCHED_ANON_KEY,
  'SUPABASE_SCHED_SERVICE_ROLE_KEY': process.env.SUPABASE_SCHED_SERVICE_ROLE_KEY,
  'SUPABASE_SCHED_PROJECT_REF': process.env.SUPABASE_SCHED_PROJECT_REF,
  'GOOGLE_MAPS_API_KEY': process.env.GOOGLE_MAPS_API_KEY,
};

console.log('Variable Status:');
console.log('─'.repeat(60));

for (const [key, value] of Object.entries(vars)) {
  if (!value) {
    console.log(`❌ ${key}: NOT SET`);
  } else if (value.includes('your-') || value.includes('YOUR')) {
    console.log(`⚠️  ${key}: PLACEHOLDER VALUE (needs replacement)`);
    console.log(`   Current: ${value.substring(0, 50)}${value.length > 50 ? '...' : ''}`);
  } else {
    // Mask the value for security
    const masked = value.length > 20 
      ? `${value.substring(0, 10)}...${value.substring(value.length - 4)}`
      : '***';
    console.log(`✅ ${key}: SET (${masked})`);
  }
}

console.log('─'.repeat(60));
console.log('');

// Check if PROJECT_REF matches URL
const url = process.env.SUPABASE_SCHED_URL;
const ref = process.env.SUPABASE_SCHED_PROJECT_REF;

if (url && ref) {
  const urlMatch = url.match(/https:\/\/([a-z0-9-]+)\.supabase\.co/i);
  const urlRef = urlMatch ? urlMatch[1] : null;
  
  if (urlRef && ref === urlRef) {
    console.log('✅ PROJECT_REF matches URL project ID');
  } else if (urlRef) {
    console.log('❌ PROJECT_REF MISMATCH:');
    console.log(`   URL contains: ${urlRef}`);
    console.log(`   PROJECT_REF is: ${ref}`);
    console.log(`   These must match!`);
  } else {
    console.log('⚠️  Could not extract project ID from URL');
  }
}

console.log('');

