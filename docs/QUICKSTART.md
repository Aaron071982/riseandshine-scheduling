# Quick Start Guide

## 🚀 Running the Demo

### Step 1: Run the Matching Algorithm

```bash
npm run start
```

This processes your CSV files and generates:
- `matches_output.csv` - CSV results
- `public/matches_data.json` - JSON data for frontend

### Step 2: Start the Web Server

```bash
npm run serve
```

Or run both together:

```bash
npm run demo
```

### Step 3: Open in Browser

Navigate to: **http://localhost:3000**

## 🗺️ Google Maps (Optional)

The dashboard works **without** a Google Maps API key! The map will show a placeholder message, but all matching data is still visible in the results list.

To enable the interactive map:
1. Get a free API key from [Google Cloud Console](https://console.cloud.google.com/google/maps-apis)
2. Open `public/index.html`
3. Replace `AIzaSyDummyKeyReplaceWithRealKey` with your key

## 📊 What You'll See

- **Statistics Dashboard**: Total clients, matched count, pending count, total hours
- **Interactive Map**: Visual representation of client-RBT connections (if API key is set)
- **Results List**: Filterable cards showing:
  - Client information
  - RBT assignments
  - Match status (matched/pending)
  - Hours matched
  - Transport modes

## 🎨 Features

✅ Automatic address generation for missing data
✅ Random transport mode assignment (Car/Public Transit/Either)
✅ Location-based matching using borough compatibility
✅ Schedule overlap calculation
✅ Fair workload distribution
✅ Beautiful Rise and Shine branded UI

Enjoy your demo! 🌟

