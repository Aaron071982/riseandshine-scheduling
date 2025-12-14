#!/usr/bin/env node

/**
 * Script to update public/config.js from .env file
 * Run this after updating .env to sync the config
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const envPath = path.join(__dirname, '..', '.env');
const configPath = path.join(__dirname, '..', 'public', 'config.js');

// Read .env file
let envVars = {};
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        line = line.trim();
        if (line && !line.startsWith('#')) {
            const [key, ...valueParts] = line.split('=');
            if (key && valueParts.length > 0) {
                envVars[key.trim()] = valueParts.join('=').trim();
            }
        }
    });
}

// Also check process.env (from dotenv)
const googleMapsKey = process.env.GOOGLE_MAPS_API_KEY || envVars.GOOGLE_MAPS_API_KEY || '';
const port = process.env.PORT || envVars.PORT || '3000';
const nodeEnv = process.env.NODE_ENV || envVars.NODE_ENV || 'development';

// Generate config.js content
const configContent = `// Configuration file - auto-generated from .env
// Run: npm run update-config (or node scripts/update-config.js)
// This file is generated/updated from .env
// For production, consider using a build step to inject environment variables

window.APP_CONFIG = {
    GOOGLE_MAPS_API_KEY: '${googleMapsKey}',
    PORT: ${port},
    NODE_ENV: '${nodeEnv}'
};
`;

// Write config.js
fs.writeFileSync(configPath, configContent, 'utf-8');
console.log('✅ Updated public/config.js from .env');
console.log(`   Google Maps API Key: ${googleMapsKey ? googleMapsKey.substring(0, 10) + '...' : 'NOT SET'}`);

