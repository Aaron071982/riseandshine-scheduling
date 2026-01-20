/**
 * Scheduler for Automated Matching Jobs
 * 
 * Runs matching automatically on schedule (nightly at 2 AM) and on startup if needed.
 * Uses in-process checks with setInterval to avoid external cron dependencies.
 */

import { getSchedulingClient, isDBValidated } from '../lib/supabaseSched';
import { getActiveRBTs } from '../lib/rbts';
import { loadClients } from '../lib/clients';
import { matchClientsToRBTs } from '../lib/scheduling/matcher';
import { randomUUID } from 'crypto';
import { config } from '../lib/config';

let schedulerInterval: NodeJS.Timeout | null = null;
let isRunning = false; // Prevent concurrent runs

/**
 * Parses cron-like time string (e.g., "0 2 * * *" = 2:00 AM)
 * Returns hour and minute
 */
function parseCronTime(cronStr: string): { hour: number; minute: number } {
  const parts = cronStr.trim().split(/\s+/);
  if (parts.length >= 2) {
    const minute = parseInt(parts[0], 10) || 0;
    const hour = parseInt(parts[1], 10) || 2;
    return { hour, minute };
  }
  return { hour: 2, minute: 0 }; // Default 2:00 AM
}

/**
 * Checks if current local time is within the scheduled window
 */
function isScheduledTime(): boolean {
  const { hour, minute } = parseCronTime(config.schedulerCronLocal);
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  
  // Check if we're within the 15-minute window (2:00-2:15 AM)
  if (currentHour === hour) {
    return currentMinute >= minute && currentMinute < minute + 15;
  }
  
  return false;
}

/**
 * Checks if matching was run today
 */
async function wasRunToday(): Promise<boolean> {
  if (!isDBValidated()) {
    return false;
  }
  
  try {
    const supabase = getSchedulingClient();
    const { data, error } = await supabase
      .from('scheduling_meta')
      .select('last_matching_run_at')
      .eq('id', 1)
      .single();
    
    if (error || !data || !data.last_matching_run_at) {
      return false;
    }
    
    const lastRun = new Date(data.last_matching_run_at);
    const today = new Date();
    
    // Check if last run was today (same date)
    return (
      lastRun.getFullYear() === today.getFullYear() &&
      lastRun.getMonth() === today.getMonth() &&
      lastRun.getDate() === today.getDate()
    );
  } catch (error) {
    console.error('Error checking if run today:', error);
    return false;
  }
}

/**
 * Checks if last run was older than 24 hours
 */
async function shouldRunOnStartup(): Promise<boolean> {
  if (!isDBValidated()) {
    return false;
  }
  
  try {
    const supabase = getSchedulingClient();
    const { data, error } = await supabase
      .from('scheduling_meta')
      .select('last_matching_run_at')
      .eq('id', 1)
      .single();
    
    if (error || !data || !data.last_matching_run_at) {
      // No previous run - should run if it's after 2 AM
      const now = new Date();
      const { hour } = parseCronTime(config.schedulerCronLocal);
      return now.getHours() >= hour;
    }
    
    const lastRun = new Date(data.last_matching_run_at);
    const now = new Date();
    const hoursSinceLastRun = (now.getTime() - lastRun.getTime()) / (1000 * 60 * 60);
    
    // Run if last run was more than 24 hours ago AND it's after scheduled time
    const { hour } = parseCronTime(config.schedulerCronLocal);
    return hoursSinceLastRun >= 24 && now.getHours() >= hour;
  } catch (error) {
    console.error('Error checking startup run condition:', error);
    return false;
  }
}

/**
 * Runs the matching job
 */
async function runMatchingJob(): Promise<void> {
  if (isRunning) {
    console.log('⏭️  Matching job already running, skipping...');
    return;
  }
  
  isRunning = true;
  
  try {
    console.log('\n🔔 Scheduled matching job triggered');
    
    const runId = randomUUID();
    const runStartTime = Date.now();
    
    // Load data
    const rbts = await getActiveRBTs();
    const clients = await loadClients();
    
    if (rbts.length === 0 || clients.length === 0) {
      console.warn('⚠️  Cannot run matching: insufficient data');
      return;
    }
    
    // Run matching
    const matches = await matchClientsToRBTs(clients, rbts);
    const runDurationSec = Math.round((Date.now() - runStartTime) / 1000);
    
    // Calculate summary
    const matchedCount = matches.filter(m => m.status === 'matched').length;
    const standbyCount = matches.filter(m => m.status === 'standby').length;
    const noLocationCount = matches.filter(m => m.status === 'no_location').length;
    const needsReviewCount = matches.filter(m => m.needsReview).length;
    
    // Write to database
    const supabase = getSchedulingClient();
    const computedAt = new Date().toISOString();
    
    try {
      // Deactivate old matches
      await supabase
        .from('matches')
        .update({ active: false })
        .eq('active', true);
      
      // Insert new matches
      const matchesToInsert = matches
        .filter(m => m.status === 'matched' || m.status === 'needs_review')
        .map(m => ({
          client_id: m.client.id,
          rbt_id: m.rbt?.id || null,
          status: m.status,
          travel_time_seconds: m.travelTimeSeconds,
          travel_time_minutes: m.travelTimeMinutes,
          distance_miles: m.distanceMiles,
          travel_mode: m.travelMode || null,
          client_geocode_precision: m.client.geocode_precision || null,
          rbt_geocode_precision: m.rbt?.geocode_precision || null,
          needs_review: m.needsReview || false,
          review_reason: m.reviewReason || null,
          reason: m.reason || null,
          run_id: runId,
          computed_at: computedAt,
          active: true,
        }));
      
      if (matchesToInsert.length > 0) {
        await supabase
          .from('matches')
          .insert(matchesToInsert);
      }
      
      // Update scheduling_meta
      const summary = {
        matchedCount,
        standbyCount,
        noLocationCount,
        needsReviewCount,
        durationSec: runDurationSec,
        runId,
      };
      
      await supabase
        .from('scheduling_meta')
        .update({
          last_matching_run_at: computedAt,
          last_matching_summary: summary,
          updated_at: computedAt,
        })
        .eq('id', 1);
      
      console.log(`✅ Scheduled matching completed: ${matchedCount} matched, ${standbyCount} standby (${runDurationSec}s)`);
    } catch (dbError: any) {
      console.error('❌ Error writing to database during scheduled run:', dbError);
    }
  } catch (error: any) {
    console.error('❌ Error in scheduled matching job:', error);
  } finally {
    isRunning = false;
  }
}

/**
 * Starts the scheduler
 */
export async function startScheduler(): Promise<void> {
  if (!config.schedulerEnabled) {
    console.log('⏭️  Scheduler disabled (SCHEDULER_ENABLED=false)');
    return;
  }
  
  if (!isDBValidated()) {
    console.log('⏭️  Scheduler disabled (database not validated)');
    return;
  }
  
  console.log('\n⏰ Starting matching scheduler...');
  console.log(`   Schedule: ${config.schedulerCronLocal} (${config.timezone})`);
  
  // Check if we should run on startup
  const shouldRun = await shouldRunOnStartup();
  if (shouldRun) {
    console.log('   Running matching on startup (last run was >24h ago and after scheduled time)');
    await runMatchingJob();
  } else {
    const wasToday = await wasRunToday();
    if (wasToday) {
      console.log('   Matching already run today, skipping startup run');
    } else {
      console.log('   Waiting for scheduled time or manual trigger');
    }
  }
  
  // Set up interval to check every 15 minutes
  schedulerInterval = setInterval(async () => {
    if (!isDBValidated()) {
      return;
    }
    
    // Check if it's scheduled time and we haven't run today
    if (isScheduledTime()) {
      const wasToday = await wasRunToday();
      if (!wasToday && !isRunning) {
        await runMatchingJob();
      }
    }
  }, 15 * 60 * 1000); // Check every 15 minutes
  
  console.log('   ✅ Scheduler started (checks every 15 minutes)');
}

/**
 * Stops the scheduler
 */
export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('⏹️  Scheduler stopped');
  }
}

