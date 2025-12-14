// Application state
let matchesData = null;
let filteredMatches = [];
let currentFilter = 'all';
let map = null;
let markers = [];
let lines = [];
let directionsRenderers = []; // Store DirectionsRenderer instances
let infoWindows = [];
let geocodedAddresses = new Map(); // Cache geocoded addresses
let routeCache = new Map(); // Cache route results by match ID
let selectedMatchId = null; // Track selected match for showing connections
let showAllRoutes = false; // Toggle for showing all routes

// Initialize the application
async function init() {
    try {
        console.log('🚀 Initializing application...');
        
        // Load matches data
        console.log('📥 Loading matches_data.json...');
        const response = await fetch('matches_data.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        matchesData = await response.json();
        console.log('✅ Data loaded:', {
            matches: matchesData.matches?.length || 0,
            rbts: matchesData.rbts?.length || 0,
            clients: matchesData.clients?.length || 0,
            summary: matchesData.summary
        });
        
        // Initialize UI
        updateStats();
        renderRBTProfiles();
        renderClientProfiles();
        renderActivityLogs();
        renderResults();
        
        console.log('✅ UI initialized');
        
        // Wait for Google Maps to load
        if (typeof google !== 'undefined' && google.maps) {
            console.log('🗺️ Google Maps already loaded');
            initMap();
        } else {
            console.log('⏳ Waiting for Google Maps to load...');
            // Listen for Maps API to load
            window.addEventListener('google-maps-loaded', () => {
                console.log('🗺️ Google Maps loaded via event');
                initMap();
            });
            // Fallback: try after a delay
            setTimeout(() => {
                if (typeof google !== 'undefined' && google.maps) {
                    console.log('🗺️ Google Maps loaded via timeout');
                    initMap();
                } else {
                    console.warn('⚠️ Google Maps not loaded, showing fallback');
                    showMapFallback();
                }
            }, 3000);
        }
        
        // Setup filter buttons
        setupFilters();
        
        // Setup search
        setupSearch();
        
        // Setup collapsible sections
        setupCollapsibleSections();
        
    } catch (error) {
        console.error('❌ Error loading data:', error);
        const resultsList = document.getElementById('results-list');
        if (resultsList) {
            resultsList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">Error</div>
                    <p style="font-size: 16px; color: #666;">Error loading data: ${error.message}</p>
                    <p style="font-size: 12px; color: #999; margin-top: 10px;">Check browser console for details</p>
                </div>
            `;
        }
    }
}

// Show fallback message for map
function showMapFallback() {
    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;
    
    mapContainer.innerHTML = `
        <div style="padding: 40px; text-align: center; color: #666; height: 100%; display: flex; flex-direction: column; justify-content: center; background: var(--color-off-white); border-radius: 8px;">
            <h3 style="color: var(--color-orange); margin-bottom: 12px; font-size: 20px; font-weight: 600;">Google Maps Loading</h3>
            <p style="color: #666; margin-bottom: 16px; font-size: 16px;">The matching algorithm is working - check the results list below.</p>
            <p style="font-size: 14px; color: #999;">If this persists, check that your Google Maps API key is valid in config.js</p>
        </div>
    `;
}

// Geocode address using Google Maps Geocoding API
async function geocodeAddress(address) {
    // Check cache first
    if (geocodedAddresses.has(address)) {
        return geocodedAddresses.get(address);
    }
    
    if (typeof google === 'undefined' || !google.maps || !google.maps.Geocoder) {
        // Fallback to estimated coordinates
        return geocodeAddressFallback(address);
    }
    
    return new Promise((resolve) => {
        const geocoder = new google.maps.Geocoder();
        
        geocoder.geocode({ address: address }, (results, status) => {
            if (status === 'OK' && results && results[0]) {
                const location = results[0].geometry.location;
                const coords = {
                    lat: location.lat(),
                    lng: location.lng()
                };
                // Cache the result
                geocodedAddresses.set(address, coords);
                resolve(coords);
            } else {
                console.warn(`Geocoding failed for "${address}": ${status}`);
                // Use fallback
                const fallback = geocodeAddressFallback(address);
                geocodedAddresses.set(address, fallback);
                resolve(fallback);
            }
        });
    });
}

// Fallback geocoding with better location detection
function geocodeAddressFallback(address) {
    // Use the full address string (including name if present) for better hash variation
    const addr = address.toLowerCase();
    
    // Special cases for locations outside NYC
    if (addr.includes('hicksville')) {
        return { lat: 40.7684, lng: -73.5251 }; // Hicksville, NY
    }
    if (addr.includes('valley stream')) {
        return { lat: 40.6643, lng: -73.7085 }; // Valley Stream, NY
    }
    if (addr.includes('jamaica')) {
        return { lat: 40.6915, lng: -73.8057 }; // Jamaica, Queens
    }
    if (addr.includes('far rockaway') || addr.includes('far rockawar')) {
        return { lat: 40.6054, lng: -73.7558 }; // Far Rockaway, Queens
    }
    
    // NYC Boroughs with better coordinate coverage
    const boroughCoords = {
        'Brooklyn': { lat: 40.6782, lng: -73.9442, spread: 0.1 },
        'Queens': { lat: 40.7282, lng: -73.7949, spread: 0.15 },
        'Manhattan': { lat: 40.7831, lng: -73.9712, spread: 0.08 },
        'Staten Island': { lat: 40.5795, lng: -74.1502, spread: 0.1 },
        'Bronx': { lat: 40.8448, lng: -73.8648, spread: 0.1 }
    };
    
    // Detect borough
    let borough = 'Brooklyn'; // default
    if (addr.includes('brooklyn')) borough = 'Brooklyn';
    else if (addr.includes('queens')) borough = 'Queens';
    else if (addr.includes('manhattan') || addr.includes('new york, ny')) borough = 'Manhattan';
    else if (addr.includes('staten island')) borough = 'Staten Island';
    else if (addr.includes('bronx')) borough = 'Bronx';
    
    const base = boroughCoords[borough] || boroughCoords['Brooklyn'];
    
    // Generate more realistic variation based on address hash
    // Use a more robust hash that creates better distribution
    let hash = 0;
    for (let i = 0; i < address.length; i++) {
        const char = address.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    
    // Create better spread - use both positive and negative variations
    const latOffset = ((Math.abs(hash) % 2000 - 1000) / 10000) * base.spread;
    const lngOffset = (((Math.abs(hash) * 7) % 2000 - 1000) / 10000) * base.spread;
    
    const lat = base.lat + latOffset;
    const lng = base.lng + lngOffset;
    
    return { lat, lng };
}

// Calculate travel distance and time using real coordinates
async function calculateTravelInfo(clientAddress, rbtAddress, transportMode) {
    if (typeof google === 'undefined' || !google.maps || !google.maps.geometry) {
        return calculateTravelInfoFallback(clientAddress, rbtAddress, transportMode);
    }
    
    try {
        const clientLoc = await geocodeAddress(clientAddress);
        const rbtLoc = await geocodeAddress(rbtAddress);
        
        if (clientLoc && rbtLoc) {
            const distance = google.maps.geometry.spherical.computeDistanceBetween(
                new google.maps.LatLng(clientLoc.lat, clientLoc.lng),
                new google.maps.LatLng(rbtLoc.lat, rbtLoc.lng)
            );
            
            // Convert meters to miles
            const miles = (distance / 1609.34).toFixed(1);
            
            // Estimate travel time based on transport mode and distance
            let minutes;
            if (transportMode === 'Car') {
                // Average 25-30 mph in city traffic
                minutes = Math.round((distance / 1609.34) * 2.2);
            } else if (transportMode === 'Transit') {
                // Slower on transit, ~3-4 min per mile
                minutes = Math.round((distance / 1609.34) * 3.5);
            } else {
                minutes = Math.round((distance / 1609.34) * 2.7);
            }
            
            return {
                distance: parseFloat(miles),
                time: minutes,
                feasible: minutes <= 45
            };
        }
    } catch (e) {
        console.warn('Error calculating travel:', e);
    }
    
    return calculateTravelInfoFallback(clientAddress, rbtAddress, transportMode);
}

function calculateTravelInfoFallback(clientAddress, rbtAddress, transportMode) {
    // Rough estimates
    return {
        distance: 5,
        time: 20,
        feasible: true
    };
}

// Update statistics display
function updateStats() {
    if (!matchesData) return;
    
    const matches = matchesData.matches || [];
    const summary = matchesData.summary || {};
    const matchedCount = matches.filter(m => m.status === 'matched').length;
    const scheduledCount = matches.filter(m => m.status === 'scheduled').length;
    const completedCount = matches.filter(m => m.status === 'completed').length;
    const standbyCount = matches.filter(m => m.status === 'standby').length;
    
    document.getElementById('total-clients').textContent = summary.totalClients || matches.length || 0;
    document.getElementById('matched-count').textContent = matchedCount;
    if (document.getElementById('scheduled-count')) {
        document.getElementById('scheduled-count').textContent = scheduledCount;
    }
    if (document.getElementById('completed-count')) {
        document.getElementById('completed-count').textContent = completedCount;
    }
    document.getElementById('standby-count').textContent = standbyCount;
    document.getElementById('total-rbts').textContent = summary.totalRBTs || 0;
}

// Render RBT Profiles
function renderRBTProfiles() {
    const container = document.getElementById('rbt-profiles');
    if (!container || !matchesData || !matchesData.rbts) {
        return;
    }

    const rbts = matchesData.rbts;
    container.innerHTML = rbts.map(rbt => {
        const location = rbt.zip ? `Zip: ${rbt.zip}` : (rbt.location || 'Location TBD');
        return `
            <div class="profile-item">
                <div class="profile-item-header">
                    <div class="profile-item-name">${rbt.name}</div>
                    <div class="profile-item-badge active">Active</div>
                </div>
                <div class="profile-item-details">
                    <div class="profile-item-detail">
                        <span class="profile-item-detail-icon"></span>
                        <span>${location}</span>
                    </div>
                    ${rbt.transportMode ? `
                    <div class="profile-item-detail">
                        <span class="profile-item-detail-icon"></span>
                        <span>${rbt.transportMode}</span>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    if (rbts.length === 0) {
        container.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">No RBTs found</p>';
    }
}

// Render Client Profiles
function renderClientProfiles() {
    const container = document.getElementById('client-profiles');
    if (!container || !matchesData || !matchesData.clients) {
        return;
    }

    const clients = matchesData.clients;
    container.innerHTML = clients.map(client => {
        const location = client.zip ? `Zip: ${client.zip}` : (client.location || 'Location TBD');
        const badgeClass = client.needsLocationInfo ? 'no-location' : 'active';
        const badgeText = client.needsLocationInfo ? 'Needs Location' : 'Active';
        
        return `
            <div class="profile-item">
                <div class="profile-item-header">
                    <div class="profile-item-name">${client.name}</div>
                    <div class="profile-item-badge ${badgeClass}">${badgeText}</div>
                </div>
                <div class="profile-item-details">
                    <div class="profile-item-detail">
                        <span class="profile-item-detail-icon"></span>
                        <span>${location}</span>
                    </div>
                    ${client.status ? `
                    <div class="profile-item-detail">
                        <span class="profile-item-detail-icon"></span>
                        <span>${client.status}</span>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    if (clients.length === 0) {
        container.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">No clients found</p>';
    }
}

// Render Activity Logs
function renderActivityLogs() {
    const container = document.getElementById('activity-logs');
    if (!container || !matchesData || !matchesData.matches) {
        return;
    }

    const logs = [];
    const matches = matchesData.matches;
    const summary = matchesData.summary || {};

    // Add summary log
    logs.push(`<div class="log-entry success">
        <span class="log-entry-time">[${new Date().toLocaleTimeString()}]</span>
        <span class="log-entry-message">Scheduling completed: ${summary.matchedCount || 0} matched, ${summary.standbyCount || 0} standby, ${summary.noLocationCount || 0} need location info</span>
    </div>`);

    // Add match logs
    matches.forEach(match => {
        const time = new Date().toLocaleTimeString();
        let logClass = 'warning';
        let message = '';

        if (match.status === 'matched') {
            logClass = 'success';
            message = `MATCHED: ${match.clientName} → ${match.rbtName} (${match.travelTimeMinutes || 'N/A'} min, ${match.distanceMiles || 'N/A'} miles)`;
        } else if (match.status === 'standby') {
            logClass = 'warning';
            message = `STANDBY: ${match.clientName} → ${match.reason || 'No RBT within 30 min'}`;
        } else if (match.status === 'no_location') {
            logClass = 'error';
            message = `NO LOCATION: ${match.clientName} → Missing location info (set aside for later)`;
        }

        logs.push(`<div class="log-entry ${logClass}">
            <span class="log-entry-time">[${time}]</span>
            <span class="log-entry-message">${message}</span>
        </div>`);
    });

    container.innerHTML = logs.join('');
}

// Render RBT Profiles
function renderRBTProfiles() {
    const container = document.getElementById('rbt-profiles');
    if (!container || !matchesData || !matchesData.rbts) {
        return;
    }

    const rbts = matchesData.rbts;
    container.innerHTML = rbts.map(rbt => {
        const location = rbt.zip ? `Zip: ${rbt.zip}` : (rbt.location || 'Location TBD');
        return `
            <div class="profile-item">
                <div class="profile-item-header">
                    <div class="profile-item-name">${rbt.name}</div>
                    <div class="profile-item-badge active">Active</div>
                </div>
                <div class="profile-item-details">
                    <div class="profile-item-detail">
                        <span class="profile-item-detail-icon"></span>
                        <span>${location}</span>
                    </div>
                    ${rbt.transportMode ? `
                    <div class="profile-item-detail">
                        <span class="profile-item-detail-icon"></span>
                        <span>${rbt.transportMode}</span>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    if (rbts.length === 0) {
        container.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">No RBTs found</p>';
    }
}

// Render Client Profiles
function renderClientProfiles() {
    const container = document.getElementById('client-profiles');
    if (!container || !matchesData || !matchesData.clients) {
        return;
    }

    const clients = matchesData.clients;
    container.innerHTML = clients.map(client => {
        const location = client.zip ? `Zip: ${client.zip}` : (client.location || 'Location TBD');
        const badgeClass = client.needsLocationInfo ? 'no-location' : 'active';
        const badgeText = client.needsLocationInfo ? 'Needs Location' : 'Active';
        
        return `
            <div class="profile-item">
                <div class="profile-item-header">
                    <div class="profile-item-name">${client.name}</div>
                    <div class="profile-item-badge ${badgeClass}">${badgeText}</div>
                </div>
                <div class="profile-item-details">
                    <div class="profile-item-detail">
                        <span class="profile-item-detail-icon"></span>
                        <span>${location}</span>
                    </div>
                    ${client.status ? `
                    <div class="profile-item-detail">
                        <span class="profile-item-detail-icon"></span>
                        <span>${client.status}</span>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    if (clients.length === 0) {
        container.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">No clients found</p>';
    }
}

// Render Activity Logs
function renderActivityLogs() {
    const container = document.getElementById('activity-logs');
    if (!container || !matchesData || !matchesData.matches) {
        return;
    }

    const logs = [];
    const matches = matchesData.matches;
    const summary = matchesData.summary || {};

    // Add summary log
    logs.push(`<div class="log-entry success">
        <span class="log-entry-time">[${new Date().toLocaleTimeString()}]</span>
        <span class="log-entry-message">Scheduling completed: ${summary.matchedCount || 0} matched, ${summary.standbyCount || 0} standby, ${summary.noLocationCount || 0} need location info</span>
    </div>`);

    // Add match logs
    matches.forEach(match => {
        const time = new Date().toLocaleTimeString();
        let logClass = 'warning';
        let message = '';

        if (match.status === 'matched') {
            logClass = 'success';
            message = `MATCHED: ${match.clientName} → ${match.rbtName} (${match.travelTimeMinutes || 'N/A'} min, ${match.distanceMiles || 'N/A'} miles)`;
        } else if (match.status === 'standby') {
            logClass = 'warning';
            message = `STANDBY: ${match.clientName} → ${match.reason || 'No RBT within 30 min'}`;
        } else if (match.status === 'no_location') {
            logClass = 'error';
            message = `NO LOCATION: ${match.clientName} → Missing location info (set aside for later)`;
        }

        logs.push(`<div class="log-entry ${logClass}">
            <span class="log-entry-time">[${time}]</span>
            <span class="log-entry-message">${message}</span>
        </div>`);
    });

    container.innerHTML = logs.join('');
}

// Initialize Google Maps
function initMap() {
    console.log('🗺️ Initializing Google Map...');
    
    if (typeof google === 'undefined' || !google.maps) {
        console.error('❌ Google Maps API not available');
        showMapFallback();
        return;
    }
    
    // Default center (Brooklyn/Queens area)
    const defaultCenter = { lat: 40.6782, lng: -73.9442 };
    
    try {
        map = new google.maps.Map(document.getElementById('map'), {
            zoom: 11,
            center: defaultCenter,
            styles: [
                {
                    featureType: "poi",
                    elementType: "labels",
                    stylers: [{ visibility: "off" }]
                }
            ]
        });
        
        console.log('✅ Map created');
        
        // Add markers and lines after map is loaded
        google.maps.event.addListenerOnce(map, 'idle', () => {
            console.log('🗺️ Map idle, adding markers...');
            addMarkersAndLines();
        });
    } catch (error) {
        console.error('❌ Error creating map:', error);
        showMapFallback();
    }
}

// Clear all connection lines and directions
function clearConnections() {
    lines.forEach(line => line.setMap(null));
    lines = [];
    directionsRenderers.forEach(renderer => renderer.setMap(null));
    directionsRenderers = [];
    infoWindows.forEach(iw => iw.close());
    infoWindows = [];
    selectedMatchId = null;
}

// Get directions route using Google Maps Directions API
async function getDirectionsRoute(origin, destination, travelMode) {
    const modeStr = travelMode === 'transit' ? 'transit' : 'driving';
    const cacheKey = `${origin.lat},${origin.lng}-${destination.lat},${destination.lng}-${modeStr}`;
    
    // Check cache first
    if (routeCache.has(cacheKey)) {
        return routeCache.get(cacheKey);
    }
    
    return new Promise((resolve, reject) => {
        if (typeof google === 'undefined' || !google.maps || !google.maps.DirectionsService) {
            reject(new Error('Google Maps Directions API not available'));
            return;
        }
        
        const directionsService = new google.maps.DirectionsService();
        const request = {
            origin: origin,
            destination: destination,
            travelMode: travelMode === 'transit' ? google.maps.TravelMode.TRANSIT : google.maps.TravelMode.DRIVING,
            unitSystem: google.maps.UnitSystem.IMPERIAL
        };
        
        directionsService.route(request, (result, status) => {
            if (status === 'OK' && result) {
                routeCache.set(cacheKey, result);
                resolve(result);
            } else {
                console.warn(`Directions API error: ${status}`);
                reject(new Error(`Directions failed: ${status}`));
            }
        });
    });
}

// Show connections for a specific match using Directions API
async function showConnections(match) {
    // Clear existing connections
    clearConnections();
    
    if (!match || match.status !== 'matched' || !match.rbtLocation) {
        return;
    }
    
    selectedMatchId = match.clientId;
    
    try {
        // Use client name + location for geocoding
        const clientAddr = match.clientAddress?.fullAddress || `${match.clientName}, ${match.clientLocation}`;
        // Use RBT name + location for geocoding
        const rbtAddr = match.rbtAddress?.fullAddress || `${match.rbtName}, ${match.rbtLocation}`;
        const clientLocation = await geocodeAddress(clientAddr);
        const rbtLocation = await geocodeAddress(rbtAddr);
        
        if (!clientLocation || !rbtLocation) return;
        
        // Determine travel mode from match data
        const travelMode = match.travelMode || (match.rbtTransportMode === 'Transit' ? 'transit' : match.rbtTransportMode === 'Both' ? 'driving' : 'driving');
        const modeForDirections = travelMode === 'transit' ? google.maps.TravelMode.TRANSIT : google.maps.TravelMode.DRIVING;
        
        // Get route from Directions API
        try {
            const route = await getDirectionsRoute(
                clientLocation,
                rbtLocation,
                travelMode
            );
            
            // Create DirectionsRenderer
            const directionsRenderer = new google.maps.DirectionsRenderer({
                map: map,
                directions: route,
                suppressMarkers: true, // We use our own markers
                polylineOptions: {
                    strokeColor: match.travelTimeMinutes && match.travelTimeMinutes <= 30 ? '#4CAF50' : '#FF9800',
                    strokeWeight: 5,
                    strokeOpacity: 0.8
                }
            });
            
            directionsRenderers.push(directionsRenderer);
            
            // Extract route info
            const leg = route.routes[0].legs[0];
            const distance = leg.distance.value / 1609.34; // Convert meters to miles
            const travelTime = Math.round(leg.duration.value / 60); // Convert seconds to minutes
            const feasible = travelTime <= 30;
            
            // Add midpoint marker with travel info
            const midLat = (clientLocation.lat + rbtLocation.lat) / 2;
            const midLng = (clientLocation.lng + rbtLocation.lng) / 2;
            
            const connectionInfoWindow = new google.maps.InfoWindow({
                content: `
                    <div class="map-info-window" style="text-align: center; min-width: 200px;">
                        <p style="margin: 4px 0; font-size: 14px; font-weight: 600;">Connection Details</p>
                        <hr style="margin: 8px 0; border: none; border-top: 1px solid #eee;">
                        <p style="margin: 4px 0; font-size: 12px;">Distance: <strong>${distance.toFixed(1)} miles</strong></p>
                        <p style="margin: 4px 0; font-size: 12px;">Travel Time: <strong>~${travelTime} minutes</strong></p>
                        <p style="margin: 4px 0; font-size: 12px;">Mode: <strong>${match.travelMode === 'transit' ? 'Transit' : 'Driving'}</strong></p>
                        <p style="margin: 4px 0; font-size: 13px; color: ${feasible ? '#4CAF50' : '#FF9800'}; font-weight: 600;">
                            ${feasible ? 'Feasible Route' : 'Longer Commute'}
                        </p>
                    </div>
                `,
                position: { lat: midLat, lng: midLng }
            });
            
            connectionInfoWindow.open(map);
            infoWindows.push(connectionInfoWindow);
            
            // Pan to show route
            const bounds = new google.maps.LatLngBounds();
            route.routes[0].bounds.getNorthEast();
            route.routes[0].bounds.getSouthWest();
            map.fitBounds(route.routes[0].bounds);
            
        } catch (directionsError) {
            console.warn('Directions API failed, falling back to straight line:', directionsError);
            // Fallback to straight line if Directions API fails
            const line = new google.maps.Polyline({
                path: [
                    new google.maps.LatLng(clientLocation.lat, clientLocation.lng),
                    new google.maps.LatLng(rbtLocation.lat, rbtLocation.lng)
                ],
                geodesic: true,
                strokeColor: '#4CAF50',
                strokeOpacity: 0.8,
                strokeWeight: 5,
                zIndex: 50
            });
            line.setMap(map);
            lines.push(line);
        }
        
    } catch (error) {
        console.error('Error showing connections:', error);
    }
}

// Add markers for clients and RBTs (no lines by default)
async function addMarkersAndLines() {
    // Clear existing markers
    markers.forEach(m => m.setMap(null));
    infoWindows.forEach(iw => iw.close());
    markers = [];
    infoWindows = [];
    clearConnections();
    
    const bounds = new google.maps.LatLngBounds();
    const geocodePromises = [];
    
    // First, geocode all addresses (use location borough if address not available)
    for (const match of matchesData.matches) {
        if (currentFilter !== 'all' && match.status !== currentFilter) {
            continue;
        }
        const clientAddr = match.clientAddress?.fullAddress || `${match.clientName}, ${match.clientLocation}`;
        geocodePromises.push(geocodeAddress(clientAddr));
        if (match.status === 'matched' && match.rbtLocation) {
            const rbtAddr = match.rbtAddress?.fullAddress || `${match.rbtName}, ${match.rbtLocation}`;
            geocodePromises.push(geocodeAddress(rbtAddr));
        }
    }
    
    // Wait for all geocoding to complete
    await Promise.all(geocodePromises);
    
    // Now create markers
    for (const match of matchesData.matches) {
        if (currentFilter !== 'all' && match.status !== currentFilter) {
            continue;
        }
        
        try {
            // Use client name + location for better unique positioning
            const clientAddr = match.clientAddress?.fullAddress || `${match.clientName}, ${match.clientLocation}`;
            const clientLocation = await geocodeAddress(clientAddr);
            if (!clientLocation) {
                console.warn(`Failed to geocode client: ${match.clientName} at ${clientAddr}`);
                continue;
            }
            
            bounds.extend(new google.maps.LatLng(clientLocation.lat, clientLocation.lng));
            
            // Use backend travel time data if available (more accurate)
            let travelInfo = null;
            if (match.status === 'matched' && match.rbtLocation) {
                // Prefer backend data (from Google Maps Distance Matrix API)
                if (match.travelTimeMinutes && match.distanceMiles) {
                    travelInfo = {
                        distance: match.distanceMiles,
                        time: match.travelTimeMinutes,
                        feasible: match.travelTimeMinutes <= 30
                    };
                } else {
                    // Fallback: calculate if backend data not available
                    const rbtAddr = match.rbtAddress?.fullAddress || `${match.rbtName}, ${match.rbtLocation}`;
                    travelInfo = await calculateTravelInfo(
                        clientAddr,
                        rbtAddr,
                        match.rbtTransportMode
                    );
                }
            }
            
            // Create client marker (orange color for clients)
            const clientMarker = new google.maps.Marker({
                position: clientLocation,
                map: map,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 14, // Slightly larger for visibility
                    fillColor: '#FF6B35', // Orange color for clients
                    fillOpacity: 1,
                    strokeColor: '#FFFFFF',
                    strokeWeight: 3
                },
                title: `Client: ${match.clientName} (${match.clientLocation})`,
                zIndex: 100
            });
            
            // Create client info window
            const clientInfoWindow = new google.maps.InfoWindow({
                content: `
                    <div class="map-info-window">
                        <h3 style="margin: 0 0 8px 0; color: #FF6B35; font-size: 18px; font-weight: 600;">Client: ${match.clientName}</h3>
                        <p style="margin: 4px 0; font-size: 12px; color: #666;">${match.clientAddress?.fullAddress || match.clientLocation}</p>
                        <p style="margin: 4px 0; font-size: 12px;"><strong>Status:</strong> <span style="color: ${match.status === 'matched' ? '#4CAF50' : '#FF9800'};">${match.status}</span></p>
                        <p style="margin: 4px 0; font-size: 12px;"><strong>Matched Hours:</strong> ${match.matchedHours}/20 hrs</p>
                        ${match.status === 'matched' && travelInfo ? `
                            <hr style="margin: 8px 0; border: none; border-top: 1px solid #eee;">
                            <p style="margin: 4px 0; font-size: 12px;"><strong>RBT:</strong> ${match.rbtName}</p>
                            <p style="margin: 4px 0; font-size: 14px;"><strong>Travel:</strong> ${travelInfo.distance} miles, ${travelInfo.time} min (${match.rbtTransportMode})</p>
                        <p style="margin: 4px 0; font-size: 13px; color: ${travelInfo.feasible ? '#4CAF50' : '#FF9800'}; font-weight: 600;">
                            ${travelInfo.feasible ? 'Within feasible range' : 'Longer commute'}
                        </p>
                            <button onclick="window.showConnectionsForMatch('${match.clientId}')" style="margin-top: 8px; padding: 6px 12px; background: #FF6B35; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">Show Connection</button>
                        ` : ''}
                    </div>
                `
            });
            
            clientMarker.addListener('click', () => {
                // Close other info windows
                infoWindows.forEach(iw => iw.close());
                clientInfoWindow.open(map, clientMarker);
                // Show connection if matched
                if (match.status === 'matched') {
                    showConnections(match);
                } else {
                    clearConnections();
                }
            });
            
            markers.push(clientMarker);
            infoWindows.push(clientInfoWindow);
            
            // If matched, add RBT marker
            if (match.status === 'matched' && match.rbtLocation) {
                // Use RBT name + location for better unique positioning
                const rbtAddr = match.rbtAddress?.fullAddress || `${match.rbtName}, ${match.rbtLocation}`;
                const rbtLocation = await geocodeAddress(rbtAddr);
                if (rbtLocation) {
                    bounds.extend(new google.maps.LatLng(rbtLocation.lat, rbtLocation.lng));
                    
                    // Create RBT marker (neutral grey/white color for RBTs)
                    const rbtMarker = new google.maps.Marker({
                        position: rbtLocation,
                        map: map,
                        icon: {
                            path: google.maps.SymbolPath.CIRCLE,
                            scale: 14, // Slightly larger for visibility
                            fillColor: '#666666', // Neutral grey color
                            fillOpacity: 1,
                            strokeColor: '#FFFFFF',
                            strokeWeight: 3
                        },
                        title: `RBT: ${match.rbtName} (${match.rbtLocation})`,
                        zIndex: 101
                    });
                    
                    const transportModeText = match.rbtTransportMode === 'Car' ? 'Driving' : 
                                         match.rbtTransportMode === 'Transit' ? 'Transit' : match.rbtTransportMode === 'Both' ? 'Both' : 'Car';
                    
                    const rbtInfoWindow = new google.maps.InfoWindow({
                        content: `
                            <div class="map-info-window">
                                <h3 style="margin: 0 0 8px 0; color: #666666; font-size: 18px; font-weight: 600;">RBT: ${match.rbtName}</h3>
                                <p style="margin: 4px 0; font-size: 12px; color: #666;">${match.rbtAddress?.fullAddress || match.rbtLocation}</p>
                                    <p style="margin: 4px 0; font-size: 14px;"><strong>Transport:</strong> ${transportModeText}</p>
                                <hr style="margin: 8px 0; border: none; border-top: 1px solid #eee;">
                                <p style="margin: 4px 0; font-size: 12px;"><strong>Client:</strong> ${match.clientName}</p>
                                ${travelInfo ? `
                                    <p style="margin: 4px 0; font-size: 14px;"><strong>Travel:</strong> ${travelInfo.distance} miles, ${travelInfo.time} min</p>
                                ` : ''}
                                <p style="margin: 4px 0; font-size: 12px;"><strong>Matched:</strong> ${match.matchedHours} hrs/week</p>
                                <button onclick="window.showConnectionsForMatch('${match.clientId}')" style="margin-top: 8px; padding: 6px 12px; background: #FF6B35; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">Show Connection</button>
                            </div>
                        `
                    });
                    
                    rbtMarker.addListener('click', () => {
                        infoWindows.forEach(iw => iw.close());
                        rbtInfoWindow.open(map, rbtMarker);
                        // Show connection
                        showConnections(match);
                    });
                    
                    markers.push(rbtMarker);
                    infoWindows.push(rbtInfoWindow);
                }
            }
            
        } catch (error) {
            console.error(`Error processing match for ${match.clientName}:`, error);
        }
    }
    
    // Fit map to show all markers
    if (bounds.getNorthEast().lat() !== bounds.getSouthWest().lat()) {
        map.fitBounds(bounds);
        // Add padding for better view
        const padding = { top: 50, right: 50, bottom: 50, left: 50 };
        map.fitBounds(bounds, padding);
    }
    
    console.log(`✅ Added ${markers.length} markers to map (${markers.filter(m => m.getTitle().includes('Client')).length} clients, ${markers.filter(m => m.getTitle().includes('RBT')).length} RBTs)`);
}

// Global function to show connections from result cards
window.showConnectionsForMatch = function(clientId) {
    const match = matchesData.matches.find(m => m.clientId === clientId);
    if (match) {
        showConnections(match);
        // Scroll map into view
        document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
};

// Global function to select a match (for clicking on result cards)
window.selectMatch = function(clientId) {
    const match = matchesData.matches.find(m => m.clientId === clientId);
    if (match && match.status === 'matched') {
        showConnections(match);
        // Scroll map into view
        document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
};

// Render results list
function renderResults() {
    const resultsList = document.getElementById('results-list');
    
        console.log('Rendering results:', {
        totalMatches: matchesData?.matches?.length || 0,
        filteredMatches: filteredMatches?.length || 0,
        currentFilter: currentFilter,
        totalRBTs: matchesData?.rbts?.length || 0,
        totalClients: matchesData?.clients?.length || 0
    });
    
    // Log first few matches for debugging
    if (filteredMatches && filteredMatches.length > 0) {
        console.log('First 5 matches:', filteredMatches.slice(0, 5).map(m => ({
            client: m.clientName,
            rbt: m.rbtName,
            status: m.status
        })));
    }
    
    if (!filteredMatches || filteredMatches.length === 0) {
            resultsList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">No Results</div>
                <p style="font-size: 16px; color: #666;">No matches found for selected filter.</p>
            </div>
        `;
        return;
    }
    
    // Update count display
    const countEl = document.getElementById('results-count-number');
    const totalEl = document.getElementById('results-total-number');
    if (countEl) countEl.textContent = filteredMatches.length;
    if (totalEl) totalEl.textContent = matchesData?.matches?.length || 0;
    
    resultsList.innerHTML = filteredMatches.map(match => {
        // We'll calculate travel info async in the card rendering
        // Determine travel mode display
        const travelMode = match.travelMode || (match.rbtTransportMode === 'Transit' ? 'transit' : match.rbtTransportMode === 'Both' ? 'driving' : 'driving');
        const travelModeDisplay = travelMode === 'transit' ? 'Transit' : 'Driving';
        const travelModeBadge = travelMode === 'transit' ? 'Transit' : 'Driving';
        
        const statusClass = match.status === 'matched' ? 'matched' : 
                           match.status === 'scheduled' ? 'scheduled' :
                           match.status === 'completed' ? 'completed' :
                           match.status === 'standby' ? 'standby' : 
                           match.status === 'no_location' ? 'no_location' : 'pending';
        
        // Standby reason text
        let standbyReason = 'No RBT within 30 minutes';
        if (match.status === 'no_location') {
            standbyReason = match.clientNeedsLocation ? 'Client missing location' : 'RBT missing location';
        }
        
        return `
            <div class="result-card ${statusClass}" onclick="window.selectMatch('${match.clientId}')">
                <div class="result-header">
                    <div class="result-client-name">${match.clientName}</div>
                    <div class="result-status ${statusClass}">${match.status.toUpperCase()}</div>
                </div>
                <div class="result-details">
                    <div class="result-detail">
                        <div class="result-label">Client Location</div>
                        <div class="result-value">${match.clientLocation || 'Unknown'}</div>
                        ${match.clientZip ? `<div class="result-address">Zip Code: ${match.clientZip}</div>` : ''}
                        ${match.clientAddress ? `<div class="result-address">${match.clientAddress}</div>` : ''}
                        ${match.clientNeedsLocation ? '<div class="result-address" style="color: #FF9800; font-weight: 600;">Needs location information</div>' : ''}
                    </div>
                    ${match.status === 'matched' && match.travelTimeMinutes ? `
                    <div class="result-detail">
                        <div class="result-label">Travel Time</div>
                        <div class="result-value">${match.travelTimeMinutes} minutes</div>
                        <div class="result-hours-badge">${match.travelTimeMinutes <= 30 ? 'Within Range' : 'Long Commute'}</div>
                    </div>
                    ` : ''}
                </div>
                ${match.status === 'matched' || match.status === 'scheduled' || match.status === 'completed' ? `
                    <div class="result-connection">
                        <div class="connection-line"></div>
                        <div class="connection-details">
                            <div class="rbt-info">
                                <div style="flex: 1;">
                                    <div class="rbt-name">${match.rbtName || 'No RBT assigned'}</div>
                                    <div class="rbt-location">${match.rbtLocation || match.rbtZip || 'Unknown'} ${match.rbtZip ? `(Zip: ${match.rbtZip})` : ''}</div>
                                    <div class="travel-mode-badge">Mode: ${travelModeBadge}</div>
                                </div>
                            </div>
                            ${match.travelTimeMinutes ? `
                            <div class="travel-info">
                                <div class="travel-stat">
                                    <span class="travel-label">Distance</span>
                                    <span class="travel-value">${match.distanceMiles ? match.distanceMiles.toFixed(1) : 'N/A'} miles</span>
                                </div>
                                <div class="travel-stat">
                                    <span class="travel-label">Travel Time</span>
                                    <span class="travel-value ${match.travelTimeMinutes <= 30 ? 'feasible' : 'long'}">${match.travelTimeMinutes} minutes</span>
                                </div>
                                <div class="travel-stat">
                                    <span class="travel-label">Mode</span>
                                    <span class="travel-value">${travelModeDisplay}</span>
                                </div>
                                ${match.travelTimeMinutes <= 30 ? 
                                    '<div class="travel-status feasible">Within 30 minutes</div>' :
                                    '<div class="travel-status long">Longer Commute</div>'
                                }
                            </div>
                            ` : `
                            <div class="travel-info-placeholder" data-client-id="${match.clientId}">
                                <div style="text-align: center; padding: 12px; color: #666; font-size: 14px;">
                                    Loading travel information...
                                </div>
                            </div>
                            `}
                        </div>
                        <button onclick="event.stopPropagation(); window.showConnectionsForMatch('${match.clientId}')" 
                                class="show-connection-btn">
                            Show on Map
                        </button>
                    </div>
                ` : match.status === 'standby' ? `
                    <div class="result-connection" style="opacity: 0.7;">
                        <div class="connection-details">
                            <p style="color: #FF9800; font-size: 15px; margin: 0; font-weight: 600;">STANDBY: ${standbyReason}</p>
                        </div>
                    </div>
                ` : match.status === 'no_location' ? `
                    <div class="result-connection" style="opacity: 0.7;">
                        <div class="connection-details">
                            <p style="color: #999; font-size: 15px; margin: 0; font-weight: 600;">${standbyReason} - set aside for later</p>
                        </div>
                    </div>
                ` : ''}
                <div class="result-reason" style="margin-top: 8px; font-size: 12px; color: #666;">${match.reason || 'No reason provided'}</div>
                ${match.status === 'matched' || match.status === 'scheduled' || match.status === 'completed' ? `
                    <div style="margin-top: 12px; display: flex; gap: 8px;">
                        <button onclick="event.stopPropagation(); markMatchAsScheduled('${match.clientId}')" 
                                class="action-btn secondary" style="flex: 1; padding: 8px 12px; font-size: 12px;">
                            Mark as Scheduled
                        </button>
                        <button onclick="event.stopPropagation(); markMatchAsCompleted('${match.clientId}')" 
                                class="action-btn secondary" style="flex: 1; padding: 8px 12px; font-size: 12px;">
                            Mark as Completed
                        </button>
                    </div>
                ` : match.status === 'scheduled' ? `
                    <div style="margin-top: 12px;">
                        <button onclick="event.stopPropagation(); markMatchAsCompleted('${match.clientId}')" 
                                class="action-btn secondary" style="width: 100%; padding: 8px 12px; font-size: 12px;">
                            Mark as Completed
                        </button>
                        ${match.scheduledAt ? `<div style="margin-top: 6px; font-size: 12px; color: #666;">Scheduled: ${new Date(match.scheduledAt).toLocaleString()}</div>` : ''}
                    </div>
                ` : match.status === 'completed' ? `
                    <div style="margin-top: 12px; padding: 8px; background: #e8f5e9; border-radius: 6px;">
                        <div style="font-size: 12px; color: #2e7d32; font-weight: 600;">COMPLETED</div>
                        ${match.completedAt ? `<div style="margin-top: 4px; font-size: 11px; color: #666;">Completed: ${new Date(match.completedAt).toLocaleString()}</div>` : ''}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
    
    // Load travel info asynchronously for all matched results
    setTimeout(() => {
        filteredMatches.forEach(async (match) => {
            if (match.status === 'matched' && match.rbtLocation) {
                const clientAddr = match.clientAddress?.fullAddress || `${match.clientName}, ${match.clientLocation}`;
                const rbtAddr = match.rbtAddress?.fullAddress || `${match.rbtName}, ${match.rbtLocation}`;
                const travelInfo = await calculateTravelInfo(
                    clientAddr,
                    rbtAddr,
                    match.rbtTransportMode
                );
                
                const placeholder = document.querySelector(`.travel-info-placeholder[data-client-id="${match.clientId}"]`);
                if (placeholder) {
                    placeholder.innerHTML = `
                        <div class="travel-info">
                            <div class="travel-stat">
                                <span class="travel-label">Distance</span>
                                <span class="travel-value">${travelInfo.distance} miles</span>
                            </div>
                            <div class="travel-stat">
                                <span class="travel-label">Travel Time</span>
                                <span class="travel-value ${travelInfo.feasible ? 'feasible' : 'long'}">~${travelInfo.time} min</span>
                            </div>
                            ${travelInfo.feasible ? 
                                '<div class="travel-status feasible">Within 30 minutes</div>' :
                                '<div class="travel-status long">Longer Commute</div>'
                            }
                        </div>
                    `;
                }
            }
        });
    }, 100);
}

// Global function to select match
window.selectMatch = function(clientId) {
    const match = matchesData.matches.find(m => m.clientId === clientId);
    if (match && match.status === 'matched') {
        window.showConnectionsForMatch(clientId);
    }
};

// Show all connections on the map (Client to RBT)
// Old function - replaced by renderAllRoutes
function showAllConnections_OLD() {
    clearConnections();
    
    if (!matchesData || !map) return;
    
    const matchedMatches = matchesData.matches.filter(m => m.status === 'matched' && m.rbtLocation && m.rbtName);
    console.log(`Showing ${matchedMatches.length} client-to-RBT connections on map`);
    
    // Process all matches
    Promise.all(matchedMatches.map(async (match) => {
        try {
            // Client address: use client name + location
            const clientAddr = match.clientAddress?.fullAddress || `${match.clientName}, ${match.clientLocation}`;
            // RBT address: use RBT name + location
            const rbtAddr = match.rbtAddress?.fullAddress || `${match.rbtName}, ${match.rbtLocation}`;
            
            const clientLocation = await geocodeAddress(clientAddr);
            const rbtLocation = await geocodeAddress(rbtAddr);
            
            if (clientLocation && rbtLocation) {
                // Verify we're connecting a client to an RBT, not RBT to RBT
                console.log(`Connecting: Client "${match.clientName}" (${match.clientLocation}) → RBT "${match.rbtName}" (${match.rbtLocation})`);
                
                const line = new google.maps.Polyline({
                    path: [
                        new google.maps.LatLng(clientLocation.lat, clientLocation.lng),
                        new google.maps.LatLng(rbtLocation.lat, rbtLocation.lng)
                    ],
                    geodesic: true,
                    strokeColor: '#4CAF50',
                    strokeOpacity: 0.6,
                    strokeWeight: 3,
                    map: map,
                    zIndex: 50
                });
                lines.push(line);
            }
        } catch (error) {
            console.error(`Error showing connection for client ${match.clientName} to RBT ${match.rbtName}:`, error);
        }
    })).then(() => {
        console.log(`✅ Displayed ${lines.length} client-to-RBT connections`);
    });
}

// Setup filter buttons
function setupFilters() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Update active state
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Update filter
            currentFilter = btn.dataset.filter;
            applyFilter();
        });
    });
    
    // "Show All Routes" button is handled by toggleShowAllRoutes() function via HTML onclick
    
    // Initial filter
    applyFilter();
}

// Apply filter to results
function applyFilter() {
    if (currentFilter === 'all') {
        filteredMatches = matchesData.matches;
    } else if (currentFilter === 'matched') {
        filteredMatches = matchesData.matches.filter(m => m.status === 'matched');
    } else if (currentFilter === 'standby') {
        filteredMatches = matchesData.matches.filter(m => m.status === 'standby');
    } else if (currentFilter === 'no_location') {
        filteredMatches = matchesData.matches.filter(m => m.status === 'no_location');
    } else if (currentFilter === 'pending') {
        // Legacy: show both standby and no_location as "pending"
        filteredMatches = matchesData.matches.filter(m => m.status === 'standby' || m.status === 'no_location');
    } else {
        filteredMatches = matchesData.matches.filter(m => m.status === currentFilter);
    }
    
    renderResults();
    
    // Update map to show only filtered matches
    if (map) {
        setTimeout(() => {
            addMarkersAndLines();
        }, 100);
    }
}

// Setup collapsible sections
function setupCollapsibleSections() {
    // Load saved state from localStorage
    const savedState = localStorage.getItem('collapsibleSections');
    const collapsedSections = savedState ? JSON.parse(savedState) : {};
    
    // Apply saved state
    Object.keys(collapsedSections).forEach(sectionId => {
        if (collapsedSections[sectionId]) {
            const section = document.querySelector(`[data-section="${sectionId}"]`);
            if (section) {
                section.classList.add('collapsed');
            }
        }
    });
}

// Toggle section collapse
function toggleSection(sectionId) {
    const section = document.querySelector(`[data-section="${sectionId}"]`);
    if (!section) return;
    
    section.classList.toggle('collapsed');
    
    // Save state to localStorage
    const savedState = localStorage.getItem('collapsibleSections');
    const collapsedSections = savedState ? JSON.parse(savedState) : {};
    collapsedSections[sectionId] = section.classList.contains('collapsed');
    localStorage.setItem('collapsibleSections', JSON.stringify(collapsedSections));
}

// Make toggleSection available globally
window.toggleSection = toggleSection;

// Toggle showing all routes
async function toggleShowAllRoutes() {
    showAllRoutes = !showAllRoutes;
    const btn = document.getElementById('show-all-connections-btn');
    
    if (showAllRoutes) {
        // Show all matched routes
        btn.textContent = 'Hide All Routes';
        btn.classList.add('active');
        await renderAllRoutes();
    } else {
        // Hide all routes, show only selected
        btn.textContent = 'Show All Routes';
        btn.classList.remove('active');
        clearConnections();
        if (selectedMatchId) {
            const match = matchesData.matches.find(m => m.clientId === selectedMatchId);
            if (match) {
                showConnections(match);
            }
        }
    }
}

// Make toggleShowAllRoutes available globally
window.toggleShowAllRoutes = toggleShowAllRoutes;

// Render all matched routes
async function renderAllRoutes() {
    clearConnections();
    
    if (!matchesData || !matchesData.matches) return;
    
    const matchedMatches = matchesData.matches.filter(m => m.status === 'matched' && m.rbtLocation);
    const bounds = new google.maps.LatLngBounds();
    
    for (const match of matchedMatches) {
        try {
            const clientAddr = match.clientAddress?.fullAddress || `${match.clientName}, ${match.clientLocation}`;
            const rbtAddr = match.rbtAddress?.fullAddress || `${match.rbtName}, ${match.rbtLocation}`;
            const clientLocation = await geocodeAddress(clientAddr);
            const rbtLocation = await geocodeAddress(rbtAddr);
            
            if (!clientLocation || !rbtLocation) continue;
            
            bounds.extend(new google.maps.LatLng(clientLocation.lat, clientLocation.lng));
            bounds.extend(new google.maps.LatLng(rbtLocation.lat, rbtLocation.lng));
            
            const travelMode = match.travelMode || (match.rbtTransportMode === 'Transit' ? 'transit' : match.rbtTransportMode === 'Both' ? 'driving' : 'driving');
            
            try {
                const route = await getDirectionsRoute(clientLocation, rbtLocation, travelMode);
                
                const directionsRenderer = new google.maps.DirectionsRenderer({
                    map: map,
                    directions: route,
                    suppressMarkers: true,
                    polylineOptions: {
                        strokeColor: match.travelTimeMinutes && match.travelTimeMinutes <= 30 ? '#4CAF50' : '#FF9800',
                        strokeWeight: 4,
                        strokeOpacity: 0.6
                    }
                });
                
                directionsRenderers.push(directionsRenderer);
            } catch (error) {
                console.warn(`Failed to get route for ${match.clientName}:`, error);
            }
        } catch (error) {
            console.warn(`Error rendering route for ${match.clientName}:`, error);
        }
    }
    
    if (matchedMatches.length > 0) {
        map.fitBounds(bounds);
    }
}

// Setup search with autocomplete
let searchQuery = '';
let selectedSuggestionIndex = -1;

function setupSearch() {
    const searchInput = document.getElementById('search-input');
    const suggestionsContainer = document.getElementById('search-suggestions');
    
    if (!searchInput) return;
    
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        selectedSuggestionIndex = -1;
        
        if (searchQuery.length === 0) {
            suggestionsContainer.classList.remove('show');
            applyFilter();
            return;
        }
        
        // Generate suggestions
        const suggestions = generateSuggestions(searchQuery);
        displaySuggestions(suggestions);
        
        // Apply search filter
        applySearchFilter();
    });
    
    searchInput.addEventListener('keydown', (e) => {
        const suggestions = Array.from(suggestionsContainer.querySelectorAll('.suggestion-item'));
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, suggestions.length - 1);
            updateSuggestionSelection(suggestions);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
            updateSuggestionSelection(suggestions);
        } else if (e.key === 'Enter' && selectedSuggestionIndex >= 0) {
            e.preventDefault();
            const selected = suggestions[selectedSuggestionIndex];
            if (selected) {
                searchInput.value = selected.textContent;
                searchQuery = selected.textContent.toLowerCase();
                suggestionsContainer.classList.remove('show');
                applySearchFilter();
            }
        } else if (e.key === 'Escape') {
            suggestionsContainer.classList.remove('show');
        }
    });
    
    // Close suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !suggestionsContainer.contains(e.target)) {
            suggestionsContainer.classList.remove('show');
        }
    });
}

function generateSuggestions(query) {
    if (!matchesData || !matchesData.matches) return [];
    
    const suggestions = new Set();
    
    matchesData.matches.forEach(match => {
        // Client name suggestions
        if (match.clientName && match.clientName.toLowerCase().includes(query)) {
            suggestions.add(match.clientName);
        }
        
        // RBT name suggestions
        if (match.rbtName && match.rbtName.toLowerCase().includes(query)) {
            suggestions.add(match.rbtName);
        }
    });
    
    return Array.from(suggestions).slice(0, 8); // Limit to 8 suggestions
}

function displaySuggestions(suggestions) {
    const suggestionsContainer = document.getElementById('search-suggestions');
    if (!suggestionsContainer) return;
    
    if (suggestions.length === 0) {
        suggestionsContainer.classList.remove('show');
        return;
    }
    
    suggestionsContainer.innerHTML = suggestions.map((suggestion, index) => {
        const highlighted = highlightMatch(suggestion, searchQuery);
        return `<div class="suggestion-item ${index === selectedSuggestionIndex ? 'highlight' : ''}" data-index="${index}">${highlighted}</div>`;
    }).join('');
    
    suggestionsContainer.classList.add('show');
    
    // Add click handlers
    suggestionsContainer.querySelectorAll('.suggestion-item').forEach((item, index) => {
        item.addEventListener('click', () => {
            const searchInput = document.getElementById('search-input');
            searchInput.value = suggestions[index];
            searchQuery = suggestions[index].toLowerCase();
            suggestionsContainer.classList.remove('show');
            applySearchFilter();
        });
    });
}

function highlightMatch(text, query) {
    const index = text.toLowerCase().indexOf(query);
    if (index === -1) return text;
    
    const before = text.substring(0, index);
    const match = text.substring(index, index + query.length);
    const after = text.substring(index + query.length);
    
    return `${before}<strong style="color: var(--color-orange);">${match}</strong>${after}`;
}

function updateSuggestionSelection(suggestions) {
    suggestions.forEach((item, index) => {
        if (index === selectedSuggestionIndex) {
            item.classList.add('highlight');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('highlight');
        }
    });
}

function applySearchFilter() {
    if (!matchesData || !matchesData.matches) return;
    
    if (searchQuery.length === 0) {
        applyFilter();
        return;
    }
    
    // Filter by search query
    const searchFiltered = matchesData.matches.filter(match => {
        const clientMatch = match.clientName && match.clientName.toLowerCase().includes(searchQuery);
        const rbtMatch = match.rbtName && match.rbtName.toLowerCase().includes(searchQuery);
        return clientMatch || rbtMatch;
    });
    
    // Apply status filter on top of search
    if (currentFilter === 'all') {
        filteredMatches = searchFiltered;
    } else if (currentFilter === 'matched') {
        filteredMatches = searchFiltered.filter(m => m.status === 'matched');
    } else if (currentFilter === 'scheduled') {
        filteredMatches = searchFiltered.filter(m => m.status === 'scheduled');
    } else if (currentFilter === 'completed') {
        filteredMatches = searchFiltered.filter(m => m.status === 'completed');
    } else if (currentFilter === 'standby') {
        filteredMatches = searchFiltered.filter(m => m.status === 'standby');
    } else if (currentFilter === 'no_location') {
        filteredMatches = searchFiltered.filter(m => m.status === 'no_location');
    } else {
        filteredMatches = searchFiltered.filter(m => m.status === currentFilter);
    }
    
    renderResults();
    
    // Update map
    if (map) {
        setTimeout(() => {
            addMarkersAndLines();
        }, 100);
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('📄 DOM loaded, initializing...');
        init();
    });
} else {
    console.log('📄 DOM already ready, initializing...');
    init();
}

