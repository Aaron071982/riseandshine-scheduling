# Rise and Shine - Scheduling AI Dashboard

A sophisticated RBT-to-Client scheduling matching system with an interactive visual dashboard.

## Features

- 🤖 **Intelligent Matching Algorithm**: Matches RBTs (Registered Behavior Technicians) to clients based on:
  - Location/travel feasibility
  - Schedule overlap
  - Fair workload distribution

- 📊 **Interactive Dashboard**: Beautiful frontend with:
  - Real-time statistics
  - Interactive Google Maps visualization
  - Filterable results list
  - Rise and Shine branding

- 📍 **Address Enrichment**: Automatically generates placeholder addresses for missing data

- 🚗 **Transport Mode Assignment**: Randomly assigns transport modes (Car, Public Transit, Either) to RBTs

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your Google Maps API key:
   ```bash
   GOOGLE_MAPS_API_KEY=your-actual-api-key-here
   ```

3. Get a Google Maps API key from [Google Cloud Console](https://console.cloud.google.com/google/maps-apis)

4. Update the config file (automatically runs on `npm start`):
   ```bash
   npm run update-config
   ```

**Note**: The `.env` file is gitignored for security. The `public/config.js` file is auto-generated from `.env` and is safe to commit (it's used by the frontend).

### 3. Run the Matching Algorithm

```bash
npm run start
```

This will:
- Load and parse `rbt.csv` and `clients.csv`
- Enrich data with addresses and transport modes
- Run the matching algorithm
- Generate `matches_output.csv` and `public/matches_data.json`

### 4. Start the Frontend Server

```bash
npm run serve
```

Or run both together:

```bash
npm run demo
```

### 5. View the Dashboard

Open your browser to: `http://localhost:3000`

## Project Structure

```
.
├── src/
│   ├── models.ts          # TypeScript interfaces
│   ├── csvLoader.ts       # CSV parsing and data loading
│   ├── location.ts        # Location normalization and travel feasibility
│   ├── matcher.ts         # Core matching algorithm
│   ├── dataEnrichment.ts  # Address generation and transport mode assignment
│   └── index.ts           # Main entry point
├── public/
│   ├── index.html         # Frontend HTML
│   ├── styles.css         # Rise and Shine styling
│   ├── app.js             # Frontend JavaScript
│   ├── server.js          # Simple HTTP server
│   └── matches_data.json  # Generated matching data (after running)
├── rbt.csv                # RBT data
├── clients.csv            # Client data
└── matches_output.csv     # Matching results (after running)
```

## How It Works

### Matching Algorithm

1. **Location Matching**: Uses borough-based travel feasibility rules
   - Same borough → always feasible
   - Brooklyn ↔ Queens → feasible
   - Manhattan ↔ Queens → feasible
   - etc.

2. **Schedule Overlap**: Finds overlapping time slots between:
   - Client requested times (2-6 PM weekdays by default)
   - RBT available times (9 AM-5 PM weekdays by default)

3. **Fair Distribution**: Assigns clients to RBTs to balance workload

### Data Enrichment

- **Placeholder Addresses**: For clients/RBTs without full addresses, generates realistic addresses based on borough
- **Transport Modes**: Randomly assigns Car, Public Transit, or Either to RBTs

## Configuration

### Adjust Travel Feasibility

Edit `src/location.ts` to modify the `TRAVEL_FEASIBLE_MATRIX`:

```typescript
const TRAVEL_FEASIBLE_MATRIX: Record<string, string[]> = {
  "Brooklyn": ["Brooklyn", "Queens", "Manhattan", "Staten Island"],
  // ... add/modify rules
};
```

### Change Default Schedules

Edit placeholder schedule functions in `src/csvLoader.ts`:
- `generateRBTPlaceholderSchedule()` - RBT availability
- `generateClientPlaceholderSchedule()` - Client requested times

## Demo Features

- **Statistics Dashboard**: Real-time counts of matched/pending clients and total hours
- **Interactive Map**: 
  - Blue markers = Clients
  - Orange markers = RBTs
  - Green lines = Matched pairs
  - Click markers for details
- **Filterable Results**: Filter by All, Matched, or Pending
- **Detailed Cards**: See full match details including addresses, transport modes, and hours

## Future Enhancements

- [ ] Real Google Maps Geocoding API integration
- [ ] Real travel time calculations
- [ ] Database persistence
- [ ] Real schedule data from CSV
- [ ] Multi-week scheduling
- [ ] Priority-based matching
- [ ] Export scheduling reports

## License

ISC
