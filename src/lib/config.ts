/**
 * Centralized Configuration Module
 * 
 * Reads environment variables with sensible defaults.
 * Provides typed configuration object for the entire application.
 */

// Load dotenv if not already loaded
if (!process.env.GOOGLE_MAPS_API_KEY && !process.env.SUPABASE_SCHED_URL) {
  try {
    const dotenv = require('dotenv');
    dotenv.config();
  } catch (e) {
    // dotenv not available - that's fine
  }
}

export interface AppConfig {
  // Google Maps API
  googleMapsApiKey: string;
  
  // Travel Time Configuration
  trafficModel: 'pessimistic' | 'best_guess' | 'optimistic';
  matchMaxTravelMinutes: number;
  peakBucketStartHour: number;
  peakBucketEndHour: number;
  peakBucketName: string;
  peakSampleTimes: string[]; // Array of "HH:mm" strings
  travelTimeTtlDays: number;
  
  // API Server Configuration
  apiPort: number;
  corsOrigin: string;
  
  // Scheduler Configuration
  schedulerEnabled: boolean;
  schedulerCronLocal: string;
  timezone: string;
  
  // Output Configuration
  writeMatchesJson: boolean;
}

/**
 * Parse peak sample times from comma-separated string
 */
function parsePeakSampleTimes(timesStr: string): string[] {
  const defaultTimes = ['14:30', '16:30', '18:30'];
  
  if (!timesStr || timesStr.trim() === '') {
    return defaultTimes;
  }
  
  const times = timesStr.split(',').map(t => t.trim()).filter(t => t.length > 0);
  
  // Validate format (HH:mm)
  const validTimes = times.filter(t => /^\d{1,2}:\d{2}$/.test(t));
  
  if (validTimes.length === 0) {
    console.warn('Invalid PEAK_SAMPLE_TIMES format, using defaults');
    return defaultTimes;
  }
  
  return validTimes;
}

/**
 * Parse traffic model, defaulting to pessimistic
 */
function parseTrafficModel(modelStr: string | undefined): 'pessimistic' | 'best_guess' | 'optimistic' {
  if (!modelStr) return 'pessimistic';
  
  const normalized = modelStr.toLowerCase().trim();
  if (normalized === 'best_guess' || normalized === 'best guess') return 'best_guess';
  if (normalized === 'optimistic') return 'optimistic';
  if (normalized === 'pessimistic') return 'pessimistic';
  
  console.warn(`Unknown TRAFFIC_MODEL value: ${modelStr}, defaulting to pessimistic`);
  return 'pessimistic';
}

/**
 * Get configuration object with validation
 */
export function getConfig(): AppConfig {
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || '';
  
  if (!googleMapsApiKey) {
    console.warn('⚠️ GOOGLE_MAPS_API_KEY not set - geocoding and travel time features will be limited');
  }
  
  return {
    googleMapsApiKey,
    trafficModel: parseTrafficModel(process.env.TRAFFIC_MODEL),
    matchMaxTravelMinutes: parseInt(process.env.MATCH_MAX_TRAVEL_MINUTES || '30', 10),
    peakBucketStartHour: parseInt(process.env.PEAK_BUCKET_START_HOUR || '14', 10),
    peakBucketEndHour: parseInt(process.env.PEAK_BUCKET_END_HOUR || '20', 10),
    peakBucketName: process.env.PEAK_BUCKET_NAME || 'weekday_2to8',
    peakSampleTimes: parsePeakSampleTimes(process.env.PEAK_SAMPLE_TIMES || '14:30,16:30,18:30'),
    travelTimeTtlDays: parseInt(process.env.TRAVEL_TIME_TTL_DAYS || '14', 10),
    apiPort: parseInt(process.env.API_PORT || '3001', 10),
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    schedulerEnabled: process.env.SCHEDULER_ENABLED !== 'false',
    schedulerCronLocal: process.env.SCHEDULER_CRON_LOCAL || '0 2 * * *',
    timezone: process.env.TIMEZONE || 'America/New_York',
    writeMatchesJson: process.env.WRITE_MATCHES_JSON !== 'false',
  };
}

// Export singleton config instance
export const config = getConfig();

// Export individual config getters for convenience
export const getGoogleMapsApiKey = () => config.googleMapsApiKey;
export const getTrafficModel = () => config.trafficModel;
export const getMatchMaxTravelMinutes = () => config.matchMaxTravelMinutes;
export const getPeakBucketName = () => config.peakBucketName;
export const getPeakSampleTimes = () => config.peakSampleTimes;
export const getTravelTimeTtlDays = () => config.travelTimeTtlDays;

