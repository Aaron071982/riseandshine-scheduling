/**
 * CLI script to generate match suggestions
 * 
 * Usage: npm run suggest-matches
 */

import { validateSchedulingDB, isSchedulingDBConfigured } from '../lib/supabaseSched';
import { suggestMatches } from '../lib/scheduling/suggestMatches';

async function main() {
  console.log('🚀 Starting Match Suggestion Generation\n');
  
  // Validate database connection
  if (isSchedulingDBConfigured()) {
    try {
      await validateSchedulingDB();
    } catch (error) {
      console.error('❌ Database validation failed:', error);
      process.exit(1);
    }
  } else {
    console.error('❌ Scheduling DB not configured. Set SUPABASE_SCHED_* environment variables.');
    process.exit(1);
  }
  
  try {
    const result = await suggestMatches(10); // Top 10 suggestions per RBT
    
    console.log('\n' + '='.repeat(60));
    console.log('MATCH SUGGESTION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total suggestions generated: ${result.total}`);
    console.log(`\n✅ Suggestions saved to match_suggestions table`);
    console.log(`   View them in the Admin → Potential Matches UI`);
    console.log('='.repeat(60) + '\n');
    
  } catch (error) {
    console.error('❌ Error generating suggestions:', error);
    process.exit(1);
  }
}

main().catch(console.error);

