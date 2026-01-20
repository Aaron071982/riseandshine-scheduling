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
let selectedMatchId = null;
let selectedMatch = null; // Track selected match for showing connections
let showAllRoutes = false; // Toggle for showing all routes
let verificationMap = null; // Map for location verification modal
let verificationMarker = null; // Draggable marker for verification

// Expose global functions early (will be defined later)
// This ensures onclick handlers in HTML can find them
if (typeof window !== 'undefined') {
    // Define stub functions that will be replaced with actual implementations
    window.runMatchingNow = function() {
        console.warn('runMatchingNow not yet initialized');
    };
    window.refreshData = function() {
        console.warn('refreshData not yet initialized');
    };
}

// Location quality helper function
function getLocationQuality(precision, confidence) {
    // Manual pin is always good
    if (precision === 'manual_pin') return 'good';
    
    // ROOFTOP or RANGE_INTERPOLATED with good confidence
    if ((precision === 'ROOFTOP' || precision === 'RANGE_INTERPOLATED') && 
        (confidence === null || confidence === undefined || confidence >= 0.7)) {
        return 'good';
    }
    
    // GEOMETRIC_CENTER (ZIP centroid) is medium
    if (precision === 'GEOMETRIC_CENTER') return 'medium';
    
    // APPROXIMATE or missing is bad
    if (precision === 'APPROXIMATE' || !precision) return 'bad';
    
    // Low confidence is medium at best
    if (confidence !== null && confidence !== undefined && confidence < 0.5) return 'medium';
    
    return 'medium';
}

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
        updateStats(); // Also updates KPIs
        renderRBTProfiles();
        renderClientProfiles();
        renderActivityLogs();
        
        // Initialize filteredMatches with all matches first
        if (matchesData && matchesData.matches) {
            filteredMatches = matchesData.matches;
        }
        
        renderResults();
        setupCollapsibleSections();
        setupSearch();
        setupFilters();
        renderSelectedMatchDetails(); // Initialize selected match panel
        
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
        // Try to show error in results list (check both possible locations)
        const resultsList = document.getElementById('results-list');
        if (resultsList) {
            resultsList.innerHTML = `
                <div class="empty-state" style="padding: 40px; text-align: center;">
                    <div style="font-size: 48px; color: #ccc; margin-bottom: 16px;">⚠️</div>
                    <p style="font-size: 16px; color: #666; margin-bottom: 8px;">Error loading data: ${error.message}</p>
                    <p style="font-size: 12px; color: #999;">Check browser console for details</p>
                    <button onclick="location.reload()" style="margin-top: 16px; padding: 8px 16px; background: var(--rise-orange); color: white; border: none; border-radius: 6px; cursor: pointer;">Reload Page</button>
                </div>
            `;
        }
        // Also update stats to show zeros if possible
        try {
            updateStats();
        } catch (statsError) {
            console.error('Error updating stats:', statsError);
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
    // Count both 'matched' and 'needs_review' as matched (needs_review still means they're matched)
    const matchedCount = summary.matched || matches.filter(m => m.status === 'matched' || m.status === 'needs_review').length || 0;
    const standbyCount = summary.standby || matches.filter(m => m.status === 'standby').length || 0;
    const noLocationCount = summary.noLocation || matches.filter(m => m.status === 'no_location').length || 0;
    
    // Update KPI cards (new layout)
    const matchedEl = document.getElementById('matched-count');
    if (matchedEl) matchedEl.textContent = matchedCount;
    
    const standbyEl = document.getElementById('standby-count');
    if (standbyEl) standbyEl.textContent = standbyCount;
    
    const noLocationEl = document.getElementById('no-location-count');
    if (noLocationEl) noLocationEl.textContent = noLocationCount;
    
    // Legacy elements (for backwards compatibility, check if they exist)
    if (document.getElementById('total-clients')) {
        document.getElementById('total-clients').textContent = summary.totalClients || matches.length || 0;
    }
    if (document.getElementById('scheduled-count')) {
        const scheduledCount = matches.filter(m => m.status === 'scheduled').length;
        document.getElementById('scheduled-count').textContent = scheduledCount;
    }
    if (document.getElementById('completed-count')) {
        const completedCount = matches.filter(m => m.status === 'completed').length;
        document.getElementById('completed-count').textContent = completedCount;
    }
    if (document.getElementById('total-rbts')) {
        document.getElementById('total-rbts').textContent = summary.totalRBTs || 0;
    }
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
                        <span><strong>Location:</strong> ${location}</span>
                    </div>
                    ${rbt.transportMode ? `
                    <div class="profile-item-detail">
                        <span class="profile-item-detail-icon"></span>
                        <span><strong>Transport:</strong> ${rbt.transportMode}</span>
                    </div>
                    ` : ''}
                    ${rbt.gender ? `
                    <div class="profile-item-detail">
                        <span class="profile-item-detail-icon"></span>
                        <span><strong>Gender:</strong> ${rbt.gender}</span>
                    </div>
                    ` : ''}
                    <div class="profile-item-detail" style="margin-top: 8px;">
                        <span class="profile-item-detail-icon"></span>
                        <span><strong>40-Hour Course:</strong> ${rbt.fortyHourCourseComplete ? 'Complete' : 'Not Complete'}</span>
                    </div>
                    ${!rbt.fortyHourCourseComplete ? `
                    <div class="profile-item-detail" style="margin-top: 8px; padding: 12px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px;">
                        <div style="font-size: 12px; color: #856404; font-weight: 600; margin-bottom: 8px;">⚠️ 40-Hour Course Required</div>
                        ${rbt.fortyHourCourseLink ? `
                        <a href="${rbt.fortyHourCourseLink}" target="_blank" class="action-btn primary" style="padding: 6px 12px; font-size: 12px; width: 100%; display: block; text-align: center; text-decoration: none; margin-bottom: 8px; background: #FF6B35; color: white; border-radius: 4px;">
                            Complete 40-Hour Course →
                        </a>
                        ` : `
                        <div style="font-size: 11px; color: #856404; margin-bottom: 8px; padding: 8px; background: #fff; border-radius: 4px;">Course link not available. Please contact administrator.</div>
                        `}
                        <input type="file" id="course-upload-${rbt.id}" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" multiple style="display: none;" onchange="handleCourseUpload(event, '${rbt.id}')">
                        <button onclick="document.getElementById('course-upload-${rbt.id}').click()" class="action-btn secondary" style="padding: 6px 12px; font-size: 12px; width: 100%;">
                            Upload Course Certificate
                        </button>
                    </div>
                    ` : `
                    <div class="profile-item-detail" style="margin-top: 8px; padding: 8px; background: #e8f5e9; border-radius: 6px;">
                        <span style="font-size: 12px; color: #2e7d32; font-weight: 600;">✓ 40-Hour Course Complete</span>
                    </div>
                    `}
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
                        <span><strong>Location:</strong> ${location}</span>
                    </div>
                    ${rbt.transportMode ? `
                    <div class="profile-item-detail">
                        <span class="profile-item-detail-icon"></span>
                        <span><strong>Transport:</strong> ${rbt.transportMode}</span>
                    </div>
                    ` : ''}
                    ${rbt.gender ? `
                    <div class="profile-item-detail">
                        <span class="profile-item-detail-icon"></span>
                        <span><strong>Gender:</strong> ${rbt.gender}</span>
                    </div>
                    ` : ''}
                    <div class="profile-item-detail" style="margin-top: 8px;">
                        <span class="profile-item-detail-icon"></span>
                        <span><strong>40-Hour Course:</strong> ${rbt.fortyHourCourseComplete ? 'Complete' : 'Not Complete'}</span>
                    </div>
                    ${!rbt.fortyHourCourseComplete ? `
                    <div class="profile-item-detail" style="margin-top: 8px; padding: 12px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px;">
                        <div style="font-size: 12px; color: #856404; font-weight: 600; margin-bottom: 8px;">⚠️ 40-Hour Course Required</div>
                        ${rbt.fortyHourCourseLink ? `
                        <a href="${rbt.fortyHourCourseLink}" target="_blank" class="action-btn primary" style="padding: 6px 12px; font-size: 12px; width: 100%; display: block; text-align: center; text-decoration: none; margin-bottom: 8px; background: #FF6B35; color: white; border-radius: 4px;">
                            Complete 40-Hour Course →
                        </a>
                        ` : `
                        <div style="font-size: 11px; color: #856404; margin-bottom: 8px; padding: 8px; background: #fff; border-radius: 4px;">Course link not available. Please contact administrator.</div>
                        `}
                        <input type="file" id="course-upload-${rbt.id}" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" multiple style="display: none;" onchange="handleCourseUpload(event, '${rbt.id}')">
                        <button onclick="document.getElementById('course-upload-${rbt.id}').click()" class="action-btn secondary" style="padding: 6px 12px; font-size: 12px; width: 100%;">
                            Upload Course Certificate
                        </button>
                    </div>
                    ` : `
                    <div class="profile-item-detail" style="margin-top: 8px; padding: 8px; background: #e8f5e9; border-radius: 6px;">
                        <span style="font-size: 12px; color: #2e7d32; font-weight: 600;">✓ 40-Hour Course Complete</span>
                    </div>
                    `}
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
    // Clear existing connections first
    clearConnections();
    
    // Treat 'needs_review' as matched for connection display
    const isMatched = match.status === 'matched' || match.status === 'needs_review';
    if (!match || !isMatched || !match.rbtName) {
        return;
    }
    
    selectedMatchId = match.clientId;
    
    try {
        // Use coordinates directly if available (more accurate)
        let clientLocation, rbtLocation;
        
        if (match.clientLat && match.clientLng) {
            clientLocation = { lat: match.clientLat, lng: match.clientLng };
        } else {
            // Fallback to geocoding
            const clientAddr = match.clientAddress?.fullAddress || `${match.clientName}, ${match.clientLocation}`;
            clientLocation = await geocodeAddress(clientAddr);
        }
        
        if (match.rbtLat && match.rbtLng) {
            rbtLocation = { lat: match.rbtLat, lng: match.rbtLng };
        } else {
            // Fallback to geocoding
            const rbtAddr = match.rbtAddress?.fullAddress || `${match.rbtName}, ${match.rbtLocation}`;
            rbtLocation = await geocodeAddress(rbtAddr);
        }
        
        if (!clientLocation || !rbtLocation) {
            console.warn('Missing coordinates for route display');
            return;
        }
        
        // Determine travel mode from match data
        const travelMode = match.travelMode || (match.rbtTransportMode === 'Transit' ? 'transit' : match.rbtTransportMode === 'Both' ? 'driving' : 'driving');
        const modeForDirections = travelMode === 'transit' ? google.maps.TravelMode.TRANSIT : google.maps.TravelMode.DRIVING;
        
        // Get route from Directions API (actual routing, not straight line)
        try {
            const route = await getDirectionsRoute(
                rbtLocation,  // Origin: RBT location
                clientLocation,  // Destination: Client location
                travelMode
            );
            
            // Use backend travel time data (from Distance Matrix API) for consistency
            const distance = match.distanceMiles || (route.routes[0].legs[0].distance.value / 1609.34);
            const travelTime = match.travelTimeMinutes || Math.round(route.routes[0].legs[0].duration.value / 60);
            const feasible = travelTime <= 30;
            const routeColor = feasible ? '#4CAF50' : '#FF9800';
            
            // Create DirectionsRenderer with actual route
            const directionsRenderer = new google.maps.DirectionsRenderer({
                map: map,
                directions: route,
                suppressMarkers: true, // We use our own markers
                polylineOptions: {
                    strokeColor: routeColor,
                    strokeWeight: 6,
                    strokeOpacity: 0.9
                },
                preserveViewport: false // Allow map to pan to show route
            });
            
            directionsRenderers.push(directionsRenderer);
            
            // Add route info window at midpoint
            const midLat = (clientLocation.lat + rbtLocation.lat) / 2;
            const midLng = (clientLocation.lng + rbtLocation.lng) / 2;
            
            const transportModeText = match.rbtTransportMode === 'Car' ? 'Driving' : 
                                     match.rbtTransportMode === 'Transit' ? 'Transit' : 
                                     match.rbtTransportMode === 'Both' ? 'Driving' : 'Driving';
            
            const connectionInfoWindow = new google.maps.InfoWindow({
                content: `
                    <div class="map-info-window" style="text-align: center; min-width: 220px; padding: 8px;">
                        <p style="margin: 0 0 8px 0; font-size: 15px; font-weight: 600; color: #333;">${match.rbtName} → ${match.clientName}</p>
                        <hr style="margin: 8px 0; border: none; border-top: 1px solid #eee;">
                        <p style="margin: 4px 0; font-size: 13px;"><strong>Distance:</strong> ${distance.toFixed(1)} miles</p>
                        <p style="margin: 4px 0; font-size: 13px;"><strong>Travel Time:</strong> ${travelTime} minutes</p>
                        <p style="margin: 4px 0; font-size: 13px;"><strong>Mode:</strong> ${transportModeText}</p>
                        <p style="margin: 6px 0 0 0; font-size: 12px; color: ${routeColor}; font-weight: 600;">
                            ${feasible ? '✅ Within 30 minutes' : '⚠️ Longer commute'}
                        </p>
                        ${match.reviewReason ? `<p style="margin: 4px 0; font-size: 11px; color: #FF9800;">⚠️ ${match.reviewReason}</p>` : ''}
                    </div>
                `,
                position: { lat: midLat, lng: midLng }
            });
            
            connectionInfoWindow.open(map);
            infoWindows.push(connectionInfoWindow);
            
            // Pan and zoom to show the entire route
            if (route.routes && route.routes[0] && route.routes[0].bounds) {
                map.fitBounds(route.routes[0].bounds, {
                    top: 50,
                    right: 50,
                    bottom: 50,
                    left: 50
                });
            }
            
        } catch (directionsError) {
            console.error('Directions API failed:', directionsError);
            // Show error message instead of fallback line
            const errorInfo = new google.maps.InfoWindow({
                content: `
                    <div class="map-info-window" style="text-align: center; min-width: 200px;">
                        <p style="margin: 0; font-size: 14px; color: #FF9800;">⚠️ Could not load route</p>
                        <p style="margin: 4px 0 0 0; font-size: 12px; color: #666;">${directionsError.message || 'Route calculation failed'}</p>
                    </div>
                `,
                position: { 
                    lat: (clientLocation.lat + rbtLocation.lat) / 2, 
                    lng: (clientLocation.lng + rbtLocation.lng) / 2 
                }
            });
            errorInfo.open(map);
            infoWindows.push(errorInfo);
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
    
    // Filter matches based on current filter
    // Treat 'needs_review' as matched for display purposes
    const isMatched = (status) => status === 'matched' || status === 'needs_review';
    const filteredMatchesForMap = matchesData.matches.filter(match => {
        if (match.status === 'no_location' || match.clientNeedsLocation) {
            return false;
        }
        if (currentFilter === 'all') {
            return true;
        } else if (currentFilter === 'matched') {
            return isMatched(match.status);
        } else {
            return match.status === currentFilter;
        }
    });
    
    // First, geocode addresses that don't have coordinates yet
    for (const match of filteredMatchesForMap) {
        if (!match.clientLat || !match.clientLng) {
            const clientAddr = match.clientAddress?.fullAddress || `${match.clientName}, ${match.clientLocation}`;
            geocodePromises.push(geocodeAddress(clientAddr).then(loc => {
                if (loc) {
                    match.clientLat = loc.lat;
                    match.clientLng = loc.lng;
                }
            }));
        }
        if (isMatched(match.status) && match.rbtName && (!match.rbtLat || !match.rbtLng)) {
            const rbtAddr = match.rbtAddress?.fullAddress || `${match.rbtName}, ${match.rbtLocation}`;
            geocodePromises.push(geocodeAddress(rbtAddr).then(loc => {
                if (loc) {
                    match.rbtLat = loc.lat;
                    match.rbtLng = loc.lng;
                }
            }));
        }
    }
    
    // Wait for all geocoding to complete
    await Promise.all(geocodePromises);
    
    // Store matched pairs for drawing lines
    const matchedPairs = [];
    
    // Now create markers
    for (const match of filteredMatchesForMap) {
        try {
            // Use coordinates directly from match data if available
            let clientLocation;
            if (match.clientLat && match.clientLng) {
                clientLocation = { lat: match.clientLat, lng: match.clientLng };
            } else {
                // Fallback to geocoding if coordinates not available
                const clientAddr = match.clientAddress?.fullAddress || `${match.clientName}, ${match.clientLocation}`;
                clientLocation = await geocodeAddress(clientAddr);
                if (!clientLocation) {
                    console.warn(`Failed to geocode client: ${match.clientName} at ${clientAddr}`);
                    continue;
                }
                match.clientLat = clientLocation.lat;
                match.clientLng = clientLocation.lng;
            }
            
            bounds.extend(new google.maps.LatLng(clientLocation.lat, clientLocation.lng));
            
            // Use backend travel time data if available (more accurate)
            let travelInfo = null;
            if (isMatched(match.status) && match.rbtName) {
                // Prefer backend data (from Google Maps Distance Matrix API)
                if (match.travelTimeMinutes && match.distanceMiles) {
                    travelInfo = {
                        distance: match.distanceMiles,
                        time: match.travelTimeMinutes,
                        feasible: match.travelTimeMinutes <= 30
                    };
                } else if (match.travelTimeSeconds && match.distanceMiles) {
                    travelInfo = {
                        distance: match.distanceMiles,
                        time: Math.round(match.travelTimeSeconds / 60),
                        feasible: (match.travelTimeSeconds / 60) <= 30
                    };
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
            const statusDisplay = match.status === 'needs_review' ? 'Matched (Needs Review)' : match.status;
            const statusColor = isMatched(match.status) ? '#4CAF50' : '#FF9800';
            const clientInfoWindow = new google.maps.InfoWindow({
                content: `
                    <div class="map-info-window">
                        <h3 style="margin: 0 0 8px 0; color: #FF6B35; font-size: 18px; font-weight: 600;">Client: ${match.clientName}</h3>
                        <p style="margin: 4px 0; font-size: 12px; color: #666;">${match.clientAddress?.fullAddress || match.clientLocation || 'No address'}</p>
                        <p style="margin: 4px 0; font-size: 12px;"><strong>Status:</strong> <span style="color: ${statusColor};">${statusDisplay}</span></p>
                        ${isMatched(match.status) && match.rbtName && travelInfo ? `
                            <hr style="margin: 8px 0; border: none; border-top: 1px solid #eee;">
                            <p style="margin: 4px 0; font-size: 12px;"><strong>RBT:</strong> ${match.rbtName}</p>
                            <p style="margin: 4px 0; font-size: 14px;"><strong>Travel:</strong> ${travelInfo.distance?.toFixed(1) || 'N/A'} miles, ${travelInfo.time || 'N/A'} min</p>
                            <p style="margin: 4px 0; font-size: 13px; color: ${travelInfo.feasible ? '#4CAF50' : '#FF9800'}; font-weight: 600;">
                                ${travelInfo.feasible ? '✅ Within range' : '⚠️ Longer commute'}
                            </p>
                        ` : ''}
                        ${match.reviewReason ? `<p style="margin: 4px 0; font-size: 11px; color: #FF9800;">⚠️ ${match.reviewReason}</p>` : ''}
                    </div>
                `
            });
            
            clientMarker.addListener('click', () => {
                // Close other info windows
                infoWindows.forEach(iw => iw.close());
                clientInfoWindow.open(map, clientMarker);
                // Show route if matched
                if (isMatched(match.status) && match.rbtName) {
                    showConnections(match);
                } else {
                    clearConnections();
                }
            });
            
            markers.push(clientMarker);
            infoWindows.push(clientInfoWindow);
            
            // If matched, add RBT marker and store pair for line drawing
            if (isMatched(match.status) && match.rbtName) {
                let rbtLocation;
                if (match.rbtLat && match.rbtLng) {
                    rbtLocation = { lat: match.rbtLat, lng: match.rbtLng };
                } else {
                    // Fallback to geocoding if coordinates not available
                    const rbtAddr = match.rbtAddress?.fullAddress || `${match.rbtName}, ${match.rbtLocation}`;
                    rbtLocation = await geocodeAddress(rbtAddr);
                    if (rbtLocation) {
                        match.rbtLat = rbtLocation.lat;
                        match.rbtLng = rbtLocation.lng;
                    }
                }
                
                if (rbtLocation) {
                    bounds.extend(new google.maps.LatLng(rbtLocation.lat, rbtLocation.lng));
                    
                    // Create RBT marker (neutral grey color for RBTs)
                    const rbtMarker = new google.maps.Marker({
                        position: rbtLocation,
                        map: map,
                        icon: {
                            path: google.maps.SymbolPath.CIRCLE,
                            scale: 14,
                            fillColor: '#666666',
                            fillOpacity: 1,
                            strokeColor: '#FFFFFF',
                            strokeWeight: 3
                        },
                        title: `RBT: ${match.rbtName} (${match.rbtLocation || 'No location'})`,
                        zIndex: 101
                    });
                    
                    const transportModeText = match.rbtTransportMode === 'Car' ? 'Driving' : 
                                         match.rbtTransportMode === 'Transit' ? 'Transit' : 
                                         match.rbtTransportMode === 'Both' ? 'Both' : 'Car';
                    
                    const rbtInfoWindow = new google.maps.InfoWindow({
                        content: `
                            <div class="map-info-window">
                                <h3 style="margin: 0 0 8px 0; color: #666666; font-size: 18px; font-weight: 600;">RBT: ${match.rbtName}</h3>
                                <p style="margin: 4px 0; font-size: 12px; color: #666;">${match.rbtAddress?.fullAddress || match.rbtLocation || 'No address'}</p>
                                <p style="margin: 4px 0; font-size: 14px;"><strong>Transport:</strong> ${transportModeText}</p>
                                <hr style="margin: 8px 0; border: none; border-top: 1px solid #eee;">
                                <p style="margin: 4px 0; font-size: 12px;"><strong>Client:</strong> ${match.clientName}</p>
                                ${travelInfo ? `
                                    <p style="margin: 4px 0; font-size: 14px;"><strong>Travel:</strong> ${travelInfo.distance?.toFixed(1) || 'N/A'} miles, ${travelInfo.time || 'N/A'} min</p>
                                ` : ''}
                            </div>
                        `
                    });
                    
                    rbtMarker.addListener('click', () => {
                        infoWindows.forEach(iw => iw.close());
                        rbtInfoWindow.open(map, rbtMarker);
                        // Show route when RBT marker is clicked
                        showConnections(match);
                    });
                    
                    markers.push(rbtMarker);
                    infoWindows.push(rbtInfoWindow);
                    
                    // Store the matched pair for drawing lines
                    matchedPairs.push({
                        clientLocation: clientLocation,
                        rbtLocation: rbtLocation,
                        clientMarker: clientMarker,
                        rbtMarker: rbtMarker,
                        match: match,
                        travelInfo: travelInfo
                    });
                }
            }
            
        } catch (error) {
            console.error(`Error processing match for ${match.clientName}:`, error);
        }
    }
    
    // Store matched pairs for later route display (when clicked)
    // Don't draw lines automatically - user will click to see actual route
    console.log(`✅ Prepared ${matchedPairs.length} matched pairs for route display`);
    
    // Load and display paired clients from simulation workflow
    await addSimulationPairingsToMap(bounds);
    
    // Fit map to show all markers
    if (bounds.getNorthEast().lat() !== bounds.getSouthWest().lat()) {
        map.fitBounds(bounds);
        // Add padding for better view
        const padding = { top: 50, right: 50, bottom: 50, left: 50 };
        map.fitBounds(bounds, padding);
    }
    
    // Add ALL RBTs to the map (not just matched ones)
    if (matchesData.rbts && matchesData.rbts.length > 0) {
        console.log(`📍 Adding ${matchesData.rbts.length} RBTs to map...`);
        
        for (const rbt of matchesData.rbts) {
            // Skip RBTs without location data
            if (!rbt.lat || !rbt.lng) {
                // Try to geocode if we have location string
                if (rbt.location) {
                    try {
                        const rbtLocation = await geocodeAddress(rbt.location);
                        if (rbtLocation) {
                            rbt.lat = rbtLocation.lat;
                            rbt.lng = rbtLocation.lng;
                        } else {
                            console.warn(`Could not geocode RBT: ${rbt.name} at ${rbt.location}`);
                            continue;
                        }
                    } catch (error) {
                        console.warn(`Error geocoding RBT ${rbt.name}:`, error);
                        continue;
                    }
                } else {
                    continue;
                }
            }
            
            // Check if this RBT is already added (from matched clients above)
            const alreadyAdded = markers.some(m => {
                const title = m.getTitle();
                return title.includes(`RBT: ${rbt.name}`);
            });
            
            if (alreadyAdded) {
                continue; // Skip if already added from a match
            }
            
            try {
                const rbtPosition = new google.maps.LatLng(rbt.lat, rbt.lng);
                bounds.extend(rbtPosition);
                
                // Create RBT marker (neutral grey color for RBTs)
                const rbtMarker = new google.maps.Marker({
                    position: rbtPosition,
                    map: map,
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 12, // Slightly smaller for unmatched RBTs
                        fillColor: '#666666', // Neutral grey color
                        fillOpacity: 0.8,
                        strokeColor: '#FFFFFF',
                        strokeWeight: 2
                    },
                    title: `RBT: ${rbt.name} (${rbt.location || 'No location'})`,
                    zIndex: 50 // Lower z-index so matched RBTs appear on top
                });
                
                const transportModeText = rbt.transportMode === 'Car' ? 'Driving' : 
                                     rbt.transportMode === 'Transit' ? 'Transit' : 
                                     rbt.transportMode === 'Both' ? 'Both' : 'Car';
                
                const rbtInfoWindow = new google.maps.InfoWindow({
                    content: `
                        <div class="map-info-window">
                            <h3 style="margin: 0 0 8px 0; color: #666666; font-size: 18px; font-weight: 600;">RBT: ${rbt.name}</h3>
                            <p style="margin: 4px 0; font-size: 12px; color: #666;">${rbt.location || 'Location not available'}</p>
                            <p style="margin: 4px 0; font-size: 14px;"><strong>Transport:</strong> ${transportModeText}</p>
                            ${rbt.email ? `<p style="margin: 4px 0; font-size: 12px;"><strong>Email:</strong> ${rbt.email}</p>` : ''}
                            ${rbt.phone ? `<p style="margin: 4px 0; font-size: 12px;"><strong>Phone:</strong> ${rbt.phone}</p>` : ''}
                            ${rbt.fortyHourCourseComplete ? `<p style="margin: 4px 0; font-size: 12px; color: #4CAF50;"><strong>✓ 40-Hour Course Complete</strong></p>` : ''}
                        </div>
                    `
                });
                
                rbtMarker.addListener('click', () => {
                    infoWindows.forEach(iw => iw.close());
                    rbtInfoWindow.open(map, rbtMarker);
                });
                
                markers.push(rbtMarker);
                infoWindows.push(rbtInfoWindow);
            } catch (error) {
                console.error(`Error adding RBT marker for ${rbt.name}:`, error);
            }
        }
    }
    
    // Fit map to show all markers
    if (bounds.getNorthEast().lat() !== bounds.getSouthWest().lat()) {
        map.fitBounds(bounds);
        // Add padding for better view
        const padding = { top: 50, right: 50, bottom: 50, left: 50 };
        map.fitBounds(bounds, padding);
    }
    
    const clientCount = markers.filter(m => m.getTitle().includes('Client')).length;
    const rbtCount = markers.filter(m => m.getTitle().includes('RBT')).length;
    console.log(`✅ Added ${markers.length} markers to map (${clientCount} clients, ${rbtCount} RBTs)`);
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

// Global function to select a match card
function selectMatchCard(clientId) {
    selectedMatchId = clientId;
    selectedMatch = matchesData.matches.find(m => m.clientId === clientId);
    
    // Re-render results to show selected state
    renderResults();
    
    // Show selected match details panel
    renderSelectedMatchDetails();
    
    // Update map summary
    updateMapSummary();
    
    // Show connections on map if matched (including needs_review)
    if (selectedMatch && (selectedMatch.status === 'matched' || selectedMatch.status === 'needs_review' || selectedMatch.status === 'scheduled' || selectedMatch.status === 'completed')) {
        showConnections(selectedMatch);
    } else {
        clearConnections();
    }
}

// Global function to select a match (for clicking on result cards) - kept for compatibility
window.selectMatch = selectMatchCard;

// Render selected match details panel
function renderSelectedMatchDetails() {
    const panel = document.getElementById('selected-match-details');
    if (!panel) return;
    
    if (!selectedMatch) {
        panel.classList.add('hidden');
        return;
    }
    
    panel.classList.remove('hidden');
    
    const travelMode = selectedMatch.travelMode || (selectedMatch.rbtTransportMode === 'Transit' ? 'transit' : selectedMatch.rbtTransportMode === 'Both' ? 'driving' : 'driving');
    const travelModeDisplay = travelMode === 'transit' ? 'Transit' : 'Driving';
    
    panel.innerHTML = `
        <div class="selected-match-details">
            <div class="selected-match-section">
                <div class="selected-match-section-title">Client</div>
                <div class="selected-match-info">${selectedMatch.clientName}</div>
                <div class="text-xs text-slate-500 mt-1">${selectedMatch.clientLocation || 'Unknown'}${selectedMatch.clientZip ? ` • ${selectedMatch.clientZip}` : ''}</div>
            </div>
            ${selectedMatch.rbtName ? `
            <div class="selected-match-section">
                <div class="selected-match-section-title">Assigned RBT</div>
                <div class="selected-match-info">${selectedMatch.rbtName}</div>
                <div class="text-xs text-slate-500 mt-1">${selectedMatch.rbtLocation || selectedMatch.rbtZip || 'Unknown'}</div>
            </div>
            ` : ''}
            ${selectedMatch.travelTimeMinutes ? `
            <div class="selected-match-section">
                <div class="selected-match-section-title">Route Summary</div>
                <div class="flex items-center gap-4 text-sm">
                    <div>
                        <span class="text-slate-500">Distance:</span>
                        <span class="font-semibold ml-1">${selectedMatch.distanceMiles ? selectedMatch.distanceMiles.toFixed(1) : 'N/A'} mi</span>
                    </div>
                    <div>
                        <span class="text-slate-500">Time:</span>
                        <span class="font-semibold ml-1 ${selectedMatch.travelTimeMinutes <= 30 ? 'text-green-600' : 'text-amber-600'}">${selectedMatch.travelTimeMinutes} min</span>
                    </div>
                    <div>
                        <span class="text-slate-500">Mode:</span>
                        <span class="font-semibold ml-1">${travelModeDisplay}</span>
                    </div>
                </div>
            </div>
            ` : ''}
            <div class="flex gap-2 mt-2">
                <button onclick="window.showConnectionsForMatch('${selectedMatch.clientId}')" 
                        class="px-4 py-2 text-sm font-medium text-white bg-rise-orange rounded-lg hover:bg-rise-orange-dark transition-colors">
                    View on Map
                </button>
                ${selectedMatch.status === 'matched' ? `
                <button onclick="markMatchAsScheduled('${selectedMatch.clientId}')" 
                        class="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">
                    Mark Scheduled
                </button>
                ` : ''}
            </div>
        </div>
    `;
}

// Update map summary chips
function updateMapSummary() {
    const summary = document.getElementById('selected-match-summary');
    if (!summary || !selectedMatch) {
        if (summary) summary.innerHTML = '';
        return;
    }
    
    if (selectedMatch.travelTimeMinutes) {
        summary.innerHTML = `
            <div class="flex items-center gap-2 flex-wrap">
                <span class="px-2 py-1 bg-slate-100 rounded text-xs font-medium text-slate-700">${selectedMatch.clientName}</span>
                <span class="text-slate-400">→</span>
                <span class="px-2 py-1 bg-slate-100 rounded text-xs font-medium text-slate-700">${selectedMatch.rbtName || 'N/A'}</span>
                <span class="px-2 py-1 bg-green-50 rounded text-xs font-medium text-green-700">${selectedMatch.travelTimeMinutes} min</span>
                <span class="px-2 py-1 bg-blue-50 rounded text-xs font-medium text-blue-700">${selectedMatch.distanceMiles ? selectedMatch.distanceMiles.toFixed(1) : 'N/A'} mi</span>
            </div>
        `;
    }
}

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
                           match.status === 'needs_review' ? 'needs-review' :
                           match.status === 'no_location' ? 'no_location' : 'pending';
        
        // Standby reason text
        let standbyReason = 'No RBT within 30 minutes';
        if (match.status === 'no_location') {
            standbyReason = match.clientNeedsLocation ? 'Client missing location' : 'RBT missing location';
        }
        
        // Location quality badges
        const clientQuality = getLocationQuality(match.clientGeocodePrecision, match.clientGeocodeConfidence);
        const rbtQuality = match.rbtGeocodePrecision ? getLocationQuality(match.rbtGeocodePrecision, match.rbtGeocodeConfidence) : null;
        
        // Needs review indicator
        const needsReview = match.needsReview || match.status === 'needs_review';
        const statusDisplay = match.status === 'needs_review' ? 'Review' : 
                             match.status === 'matched' ? 'Matched' : 
                             match.status === 'scheduled' ? 'Scheduled' : 
                             match.status === 'completed' ? 'Completed' : 
                             match.status === 'standby' ? 'Standby' : 'Needs Location';
        
        const isSelected = selectedMatchId === match.clientId;
        return `
            <div class="match-card ${isSelected ? 'selected' : ''} ${needsReview ? 'needs-review-card' : ''}" onclick="selectMatchCard('${match.clientId}')">
                <div class="match-card-header">
                    <div>
                        <div class="match-client-name">
                            ${match.clientName}
                            ${clientQuality !== 'good' ? `<span class="location-quality-badge ${clientQuality}" title="Client location: ${clientQuality}">${clientQuality === 'medium' ? 'ZIP' : 'Verify'}</span>` : ''}
                        </div>
                        <div class="match-client-location">${match.clientLocation || 'Unknown'}${match.clientZip ? ` • ${match.clientZip}` : ''}</div>
                    </div>
                    <span class="match-status-pill ${statusClass}">${statusDisplay}</span>
                </div>
                ${match.status === 'matched' || match.status === 'scheduled' || match.status === 'completed' ? `
                    <div class="match-rbt-info">
                        <div class="match-rbt-name">${match.rbtName || 'No RBT assigned'}</div>
                        <div class="match-rbt-location">${match.rbtLocation || match.rbtZip || 'Unknown'}${match.rbtZip ? ` • Zip: ${match.rbtZip}` : ''}</div>
                    </div>
                    ${match.travelTimeMinutes ? `
                    <div class="match-travel-info">
                        <div class="match-travel-stat">
                            <div class="match-travel-label">Distance</div>
                            <div class="match-travel-value">${match.distanceMiles ? match.distanceMiles.toFixed(1) : 'N/A'}</div>
                        </div>
                        <div class="match-travel-stat">
                            <div class="match-travel-label">Time</div>
                            <div class="match-travel-value ${match.travelTimeMinutes <= 30 ? 'feasible' : 'long'}">${match.travelTimeMinutes}m</div>
                        </div>
                        <div class="match-travel-stat">
                            <div class="match-travel-label">Mode</div>
                            <div class="match-travel-value">${travelModeDisplay}</div>
                        </div>
                    </div>
                    ` : ''}
                    <div class="match-actions">
                        <button onclick="event.stopPropagation(); window.showConnectionsForMatch('${match.clientId}')" 
                                class="match-action-btn primary">
                            View on Map
                        </button>
                        ${match.status === 'matched' ? `
                        <button onclick="event.stopPropagation(); markMatchAsScheduled('${match.clientId}')" 
                                class="match-action-btn">
                            Schedule
                        </button>
                        ` : ''}
                    </div>
                ` : match.status === 'standby' ? `
                    <div class="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
                        <p class="text-sm text-amber-700 font-medium">${standbyReason}</p>
                    </div>
                ` : match.status === 'no_location' ? `
                    <div class="mt-3 p-3 bg-slate-100 rounded-lg border border-slate-200">
                        <p class="text-sm text-slate-600 font-medium">${standbyReason} - set aside for later</p>
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
            
            // Clear selection when filter changes
            selectedMatchId = null;
            selectedMatch = null;
            
            applyFilter();
            renderSelectedMatchDetails();
            updateMapSummary();
        });
    });
    
    // "Show All Routes" button is handled by toggleShowAllRoutes() function via HTML onclick
    
    // Initial filter
    applyFilter();
}

// Apply filter to results
function applyFilter() {
    if (!matchesData || !matchesData.matches) {
        filteredMatches = [];
        renderResults();
        return;
    }
    
    if (currentFilter === 'all') {
        // Show all matches including needs_review, matched, scheduled, completed
        filteredMatches = matchesData.matches.filter(m => 
            m.status === 'matched' || 
            m.status === 'needs_review' || 
            m.status === 'scheduled' || 
            m.status === 'completed' || 
            m.status === 'standby' || 
            m.status === 'no_location'
        );
    } else if (currentFilter === 'matched') {
        // Show only matched AND needs_review (they're still matches, just need review)
        filteredMatches = matchesData.matches.filter(m => 
            m.status === 'matched' || m.status === 'needs_review'
        );
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
    renderSelectedMatchDetails();
    updateMapSummary();
    
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
        btn.classList.add('bg-rise-orange', 'text-white');
        btn.classList.remove('bg-white', 'text-slate-700');
        await renderAllRoutes();
    } else {
        // Hide all routes, show only selected
        btn.textContent = 'Show All Routes';
        btn.classList.remove('bg-rise-orange', 'text-white');
        btn.classList.add('bg-white', 'text-slate-700');
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
        if (searchInput && suggestionsContainer && 
            !searchInput.contains(e.target) && !suggestionsContainer.contains(e.target)) {
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
        // Show both 'matched' and 'needs_review' as they are both successful matches
        filteredMatches = searchFiltered.filter(m => m.status === 'matched' || m.status === 'needs_review');
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

// Handle 40-hour course certificate upload
window.handleCourseUpload = function(event, rbtId) {
    const file = event.target.files[0];
    if (file) {
        console.log(`Uploading 40-hour course certificate for RBT ${rbtId}: ${file.name}`);
        // Simulate upload process
        setTimeout(() => {
            const rbtIndex = matchesData.rbts.findIndex(r => r.id === rbtId);
            if (rbtIndex !== -1) {
                matchesData.rbts[rbtIndex].fortyHourCourseComplete = true;
                renderRBTProfiles();
                alert(`40-hour course certificate for ${matchesData.rbts[rbtIndex].name} uploaded successfully! Course marked as complete.`);
            }
        }, 1500);
    }
};

// ============================================================================
// Location Verification Modal
// ============================================================================

let currentVerifyEntity = null; // { type: 'client' | 'rbt', id: string, lat: number, lng: number }

// Open location verification modal
window.openLocationVerifyModal = function(type, id) {
    const modal = document.getElementById('location-verify-modal');
    if (!modal) return;
    
    // Find the entity
    let entity = null;
    if (type === 'client') {
        entity = matchesData.clients?.find(c => c.id === id);
    } else if (type === 'rbt') {
        entity = matchesData.rbts?.find(r => r.id === id);
    }
    
    if (!entity) {
        console.error(`Entity not found: ${type} ${id}`);
        return;
    }
    
    // Store current entity for saving
    currentVerifyEntity = {
        type,
        id,
        lat: entity.lat || 40.7128, // Default to NYC if no coords
        lng: entity.lng || -74.0060
    };
    
    // Update modal content
    document.getElementById('verify-name').textContent = entity.name || entity.full_name || 'Unknown';
    document.getElementById('verify-address').textContent = entity.address || entity.location || 'No address';
    document.getElementById('verify-precision').textContent = entity.geocodePrecision || 'Not geocoded';
    document.getElementById('verify-coords').textContent = `Lat: ${currentVerifyEntity.lat.toFixed(6)}, Lng: ${currentVerifyEntity.lng.toFixed(6)}`;
    
    // Show modal
    modal.classList.remove('hidden');
    
    // Initialize verification map after modal is visible
    setTimeout(() => {
        initVerificationMap(currentVerifyEntity.lat, currentVerifyEntity.lng);
    }, 100);
};

// Initialize the verification map with draggable marker
function initVerificationMap(lat, lng) {
    const mapContainer = document.getElementById('location-verify-map');
    if (!mapContainer || typeof google === 'undefined') {
        console.warn('Cannot initialize verification map - Google Maps not loaded');
        return;
    }
    
    // Create map
    verificationMap = new google.maps.Map(mapContainer, {
        center: { lat, lng },
        zoom: 15,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false
    });
    
    // Create draggable marker
    verificationMarker = new google.maps.Marker({
        position: { lat, lng },
        map: verificationMap,
        draggable: true,
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 14,
            fillColor: '#FF6B35',
            fillOpacity: 1,
            strokeColor: '#FFFFFF',
            strokeWeight: 3
        },
        title: 'Drag to correct location'
    });
    
    // Update coordinates display when marker is dragged
    verificationMarker.addListener('dragend', () => {
        const pos = verificationMarker.getPosition();
        if (pos) {
            currentVerifyEntity.lat = pos.lat();
            currentVerifyEntity.lng = pos.lng();
            document.getElementById('verify-coords').textContent = 
                `Lat: ${pos.lat().toFixed(6)}, Lng: ${pos.lng().toFixed(6)}`;
        }
    });
    
    // Also update on drag for real-time feedback
    verificationMarker.addListener('drag', () => {
        const pos = verificationMarker.getPosition();
        if (pos) {
            document.getElementById('verify-coords').textContent = 
                `Lat: ${pos.lat().toFixed(6)}, Lng: ${pos.lng().toFixed(6)}`;
        }
    });
}

// Close location verification modal
window.closeLocationVerifyModal = function() {
    const modal = document.getElementById('location-verify-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
    currentVerifyEntity = null;
    verificationMap = null;
    verificationMarker = null;
};

// API base URL for location updates
const API_BASE_URL = window.SCHEDULING_API_URL || 'http://localhost:3001';

// Save verified location via secure API
window.saveVerifiedLocation = async function() {
    if (!currentVerifyEntity) {
        console.error('No entity to save');
        return;
    }
    
    const { type, id, lat, lng } = currentVerifyEntity;
    
    console.log(`Saving verified location for ${type} ${id}: ${lat}, ${lng}`);
    
    // Show loading state
    const saveBtn = document.querySelector('.location-modal-actions .btn-primary');
    const originalText = saveBtn ? saveBtn.textContent : 'Save Location';
    if (saveBtn) {
        saveBtn.textContent = 'Saving...';
        saveBtn.disabled = true;
    }
    
    try {
        // Call the secure API to update location
        // This uses SERVICE_ROLE key on the server side
        const response = await fetch(`${API_BASE_URL}/api/location/update`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                entityType: type,
                entityId: id,
                lat: lat,
                lng: lng,
                source: 'manual_pin',
            }),
        });
        
        const result = await response.json();
        
        if (!response.ok || result.error) {
            throw new Error(result.message || 'Failed to save location');
        }
        
        console.log('Location saved successfully:', result);
        
        // Update local data after successful API call
        if (type === 'client') {
            const clientIndex = matchesData.clients?.findIndex(c => c.id === id);
            if (clientIndex !== -1) {
                matchesData.clients[clientIndex].lat = lat;
                matchesData.clients[clientIndex].lng = lng;
                matchesData.clients[clientIndex].geocodePrecision = 'ROOFTOP';
                matchesData.clients[clientIndex].geocodeConfidence = 1.0;
                matchesData.clients[clientIndex].needsLocationVerification = false;
            }
            
            // Also update in matches
            matchesData.matches?.forEach(m => {
                if (m.clientId === id) {
                    m.clientLat = lat;
                    m.clientLng = lng;
                    m.clientGeocodePrecision = 'ROOFTOP';
                    m.clientGeocodeConfidence = 1.0;
                }
            });
        } else if (type === 'rbt') {
            const rbtIndex = matchesData.rbts?.findIndex(r => r.id === id);
            if (rbtIndex !== -1) {
                matchesData.rbts[rbtIndex].lat = lat;
                matchesData.rbts[rbtIndex].lng = lng;
                matchesData.rbts[rbtIndex].geocodePrecision = 'ROOFTOP';
                matchesData.rbts[rbtIndex].geocodeConfidence = 1.0;
            }
            
            // Also update in matches
            matchesData.matches?.forEach(m => {
                if (m.rbtId === id) {
                    m.rbtLat = lat;
                    m.rbtLng = lng;
                    m.rbtGeocodePrecision = 'ROOFTOP';
                    m.rbtGeocodeConfidence = 1.0;
                }
            });
        }
        
        // Close modal
        closeLocationVerifyModal();
        
        // Refresh UI
        renderResults();
        if (map) {
            addMarkersAndLines();
        }
        
        // Show success message
        alert(`Location verified and saved! The ${type} location has been updated in the database.`);
        
    } catch (error) {
        console.error('Error saving location:', error);
        alert(`Failed to save location: ${error.message}\n\nMake sure the API server is running (npm run api)`);
    } finally {
        // Restore button state
        if (saveBtn) {
            saveBtn.textContent = originalText;
            saveBtn.disabled = false;
        }
    }
};

// ============================================================================
// POTENTIAL MATCHES (Admin UI)
// ============================================================================

let potentialMatchesData = [];
let currentMatchStatus = 'PENDING';

// Show Potential Matches panel
window.showPotentialMatches = function() {
    document.getElementById('matching-results-panel').classList.add('hidden');
    document.getElementById('potential-matches-panel').classList.remove('hidden');
    loadPotentialMatches();
    // Also add markers for all potential matches
    addPotentialMatchMarkers();
};

// Show Matching Results panel
window.showMatchingResults = function() {
    document.getElementById('potential-matches-panel').classList.add('hidden');
    document.getElementById('matching-results-panel').classList.remove('hidden');
    // Clear potential match markers and restore regular markers
    clearConnections();
    if (map) {
        addMarkersAndLines();
    }
};

// Add markers for all potential matches
async function addPotentialMatchMarkers() {
    if (!map || !potentialMatchesData || potentialMatchesData.length === 0) {
        return;
    }
    
    // Clear existing markers first
    markers.forEach(m => m.setMap(null));
    infoWindows.forEach(iw => iw.close());
    markers = [];
    infoWindows = [];
    clearConnections();
    
    const bounds = new google.maps.LatLngBounds();
    
    for (const match of potentialMatchesData) {
        const rbt = match.rbt_profiles;
        const client = match.clients;
        
        if (!rbt || !client || !rbt.lat || !rbt.lng || !client.lat || !client.lng) {
            continue;
        }
        
        const clientCoords = { lat: client.lat, lng: client.lng };
        const rbtCoords = { lat: rbt.lat, lng: rbt.lng };
        
        bounds.extend(clientCoords);
        bounds.extend(rbtCoords);
        
        // Add client marker
        const clientMarker = new google.maps.Marker({
            position: clientCoords,
            map: map,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 14,
                fillColor: '#FF6B35',
                fillOpacity: 1,
                strokeColor: '#FFFFFF',
                strokeWeight: 3
            },
            title: `Client: ${client.name}`,
            zIndex: 100
        });
        
        const clientInfoWindow = new google.maps.InfoWindow({
            content: `
                <div class="map-info-window">
                    <h3 style="margin: 0 0 8px 0; color: #FF6B35; font-size: 18px; font-weight: 600;">Client: ${client.name}</h3>
                    <p style="margin: 4px 0; font-size: 12px; color: #666;">${client.location_borough || client.locationBorough || client.city || 'Unknown'}</p>
                    <p style="margin: 4px 0; font-size: 12px;"><strong>Score:</strong> ${match.score.toFixed(1)}</p>
                    <button onclick="showPotentialMatchOnMap('${match.id}')" style="margin-top: 8px; padding: 6px 12px; background: #FF6B35; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">Show Route</button>
                </div>
            `
        });
        
        clientMarker.addListener('click', () => {
            infoWindows.forEach(iw => iw.close());
            clientInfoWindow.open(map, clientMarker);
            showPotentialMatchOnMap(match.id);
        });
        
        markers.push(clientMarker);
        infoWindows.push(clientInfoWindow);
        
        // Add RBT marker
        const rbtMarker = new google.maps.Marker({
            position: rbtCoords,
            map: map,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 12,
                fillColor: '#666666',
                fillOpacity: 0.8,
                strokeColor: '#FFFFFF',
                strokeWeight: 2
            },
            title: `RBT: ${rbt.full_name || rbt.first_name + ' ' + rbt.last_name}`,
            zIndex: 50
        });
        
        const rbtInfoWindow = new google.maps.InfoWindow({
            content: `
                <div class="map-info-window">
                    <h3 style="margin: 0 0 8px 0; color: #666666; font-size: 18px; font-weight: 600;">RBT: ${rbt.full_name || rbt.first_name + ' ' + rbt.last_name}</h3>
                    <p style="margin: 4px 0; font-size: 12px; color: #666;">${rbt.locationCity || 'Unknown'}</p>
                    <p style="margin: 4px 0; font-size: 12px;"><strong>Score:</strong> ${match.score.toFixed(1)}</p>
                    <button onclick="showPotentialMatchOnMap('${match.id}')" style="margin-top: 8px; padding: 6px 12px; background: #FF6B35; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">Show Route</button>
                </div>
            `
        });
        
        rbtMarker.addListener('click', () => {
            infoWindows.forEach(iw => iw.close());
            rbtInfoWindow.open(map, rbtMarker);
            showPotentialMatchOnMap(match.id);
        });
        
        markers.push(rbtMarker);
        infoWindows.push(rbtInfoWindow);
    }
    
    // Fit map to show all markers
    if (bounds.getNorthEast().lat() !== bounds.getSouthWest().lat()) {
        map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
    }
    
    console.log(`✅ Added ${markers.length} markers for potential matches`);
}

// Load potential matches from API
async function loadPotentialMatches(status = 'PENDING') {
    const listEl = document.getElementById('potential-matches-list');
    listEl.innerHTML = '<div class="text-center text-slate-500 py-8"><p>Loading potential matches...</p></div>';
    
    try {
        const url = status === 'all' 
            ? `${API_BASE_URL}/api/admin/matches/all`
            : `${API_BASE_URL}/api/admin/matches/pending`;
        
        console.log('Fetching potential matches from:', url);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });
        
        // Check if response is actually JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.error('Non-JSON response:', text.substring(0, 200));
            throw new Error(`Server returned ${response.status} ${response.statusText}. Expected JSON but got: ${contentType || 'unknown'}`);
        }
        
        const result = await response.json();
        
        if (!response.ok || result.error) {
            throw new Error(result.message || `Server error: ${response.status} ${response.statusText}`);
        }
        
        potentialMatchesData = result.matches || [];
        renderPotentialMatches(potentialMatchesData, status);
        
        document.getElementById('potential-matches-count').textContent = potentialMatchesData.length;
        
    } catch (error) {
        console.error('Error loading potential matches:', error);
        listEl.innerHTML = `
            <div class="text-center text-red-500 py-8">
                <p class="font-semibold">Error loading matches</p>
                <p class="text-sm mt-2">${error.message}</p>
                <p class="text-xs text-slate-500 mt-4">Make sure:</p>
                <ul class="text-xs text-slate-500 mt-2 text-left inline-block">
                    <li>• API server is running: <code class="bg-slate-100 px-1 rounded">npm run api</code></li>
                    <li>• API URL is correct: <code class="bg-slate-100 px-1 rounded">${API_BASE_URL}</code></li>
                    <li>• Database is configured and validated</li>
                </ul>
                <button onclick="loadPotentialMatches('${status}')" class="mt-4 px-4 py-2 text-sm font-medium text-white bg-rise-orange rounded-lg hover:bg-rise-orange-dark transition-colors">
                    Retry
                </button>
            </div>
        `;
    }
}

// Render potential matches list
function renderPotentialMatches(matches, statusFilter) {
    const listEl = document.getElementById('potential-matches-list');
    
    if (matches.length === 0) {
        listEl.innerHTML = `
            <div class="text-center text-slate-500 py-8">
                <p>No ${statusFilter === 'all' ? '' : statusFilter.toLowerCase()} matches found.</p>
                <button onclick="refreshSuggestions()" class="mt-4 px-4 py-2 text-sm font-medium text-white bg-rise-orange rounded-lg hover:bg-rise-orange-dark transition-colors">
                    Generate Suggestions
                </button>
            </div>
        `;
        return;
    }
    
    // Filter by status if not 'all'
    const filtered = statusFilter === 'all' 
        ? matches 
        : matches.filter(m => m.status === statusFilter);
    
    listEl.innerHTML = filtered.map(match => {
        const rbt = match.rbt_profiles;
        const client = match.clients;
        const rationale = match.rationale || {};
        const travelTime = rationale.travelTimeMinutes || match.travel_time_sec ? Math.round(match.travel_time_sec / 60) : null;
        const distance = rationale.distanceMiles || (match.distance_meters ? Math.round(match.distance_meters / 1609.34 * 10) / 10 : null);
        
        const statusBadge = {
            'PENDING': '<span class="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded">Pending</span>',
            'APPROVED': '<span class="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded">Approved</span>',
            'REJECTED': '<span class="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded">Rejected</span>',
        }[match.status] || '';
        
        const qualityBadge = {
            'Good': '<span class="px-2 py-0.5 text-xs bg-green-50 text-green-700 rounded">Good</span>',
            'Medium': '<span class="px-2 py-0.5 text-xs bg-yellow-50 text-yellow-700 rounded">Medium</span>',
            'Bad': '<span class="px-2 py-0.5 text-xs bg-red-50 text-red-700 rounded">Bad</span>',
        };
        
        return `
            <div class="border border-slate-200 rounded-lg p-4 mb-3 hover:shadow-md transition-shadow ${match.status === 'PENDING' ? 'bg-white' : match.status === 'APPROVED' ? 'bg-green-50/30' : 'bg-red-50/30'}">
                <div class="flex items-start justify-between mb-3">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-2">
                            <h3 class="font-semibold text-slate-900">${client?.name || 'Unknown Client'}</h3>
                            ${statusBadge}
                            <span class="px-2 py-1 text-xs font-bold bg-blue-100 text-blue-800 rounded">Score: ${match.score.toFixed(1)}</span>
                        </div>
                        <p class="text-sm text-slate-600 mb-1">
                            <strong>RBT:</strong> ${rbt?.full_name || rbt?.first_name + ' ' + rbt?.last_name || 'Unknown'} 
                            ${rbt?.city ? `(${rbt.city}, ${rbt.state})` : ''}
                        </p>
                        <p class="text-sm text-slate-600">
                            <strong>Client:</strong> ${client?.location_borough || client?.locationBorough || client?.city || 'Unknown Location'}
                            ${client?.zip ? ` · ${client.zip}` : ''}
                        </p>
                    </div>
                </div>
                
                <div class="grid grid-cols-2 gap-3 mb-3 text-sm">
                    <div>
                        <span class="text-slate-500">Travel Time:</span>
                        <span class="font-medium ml-1">${travelTime ? travelTime + ' min' : 'N/A'}</span>
                    </div>
                    <div>
                        <span class="text-slate-500">Distance:</span>
                        <span class="font-medium ml-1">${distance ? distance + ' mi' : 'N/A'}</span>
                    </div>
                    <div>
                        <span class="text-slate-500">Client Quality:</span>
                        <span class="ml-1">${qualityBadge[rationale.geocodeQuality?.client || 'Bad']}</span>
                    </div>
                    <div>
                        <span class="text-slate-500">RBT Quality:</span>
                        <span class="ml-1">${qualityBadge[rationale.geocodeQuality?.rbt || 'Bad']}</span>
                    </div>
                </div>
                
                ${rationale.flags && rationale.flags.length > 0 ? `
                    <div class="mb-3">
                        <div class="flex flex-wrap gap-1">
                            ${rationale.flags.map(flag => `<span class="px-2 py-0.5 text-xs bg-slate-100 text-slate-700 rounded">${flag}</span>`).join('')}
                        </div>
                    </div>
                ` : ''}
                
                <div class="flex gap-2 mt-3">
                    <button onclick="showPotentialMatchOnMap('${match.id}')" class="flex-1 px-3 py-2 text-sm font-medium text-white bg-rise-orange rounded-lg hover:bg-rise-orange-dark transition-colors">
                        View on Map
                    </button>
                    ${match.status === 'PENDING' ? `
                        <button onclick="approveMatch('${match.id}')" class="px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors">
                            Approve
                        </button>
                        <button onclick="rejectMatch('${match.id}')" class="px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors">
                            Reject
                        </button>
                    ` : `
                        <div class="text-xs text-slate-500 flex items-center px-3">
                            ${match.decided_at ? `Decided: ${new Date(match.decided_at).toLocaleDateString()}` : ''}
                            ${match.decided_by ? ` by ${match.decided_by}` : ''}
                        </div>
                    `}
                </div>
                
                ${match.needs_review ? `
                    <div class="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                        <strong>⚠️ Needs Review:</strong> ${match.review_reason || 'Location quality issues'}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

// Approve a match
window.approveMatch = async function(matchId) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/matches/${matchId}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decidedBy: 'admin' }),
        });
        
        const result = await response.json();
        
        if (!response.ok || result.error) {
            throw new Error(result.message || 'Failed to approve match');
        }
        
        // Reload matches
        loadPotentialMatches(currentMatchStatus);
        
    } catch (error) {
        console.error('Error approving match:', error);
        alert(`Failed to approve match: ${error.message}`);
    }
};

// Reject a match
window.rejectMatch = async function(matchId) {
    const reason = prompt('Reason for rejection (optional):');
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/matches/${matchId}/reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decidedBy: 'admin', reason }),
        });
        
        const result = await response.json();
        
        if (!response.ok || result.error) {
            throw new Error(result.message || 'Failed to reject match');
        }
        
        // Reload matches
        loadPotentialMatches(currentMatchStatus);
        
    } catch (error) {
        console.error('Error rejecting match:', error);
        alert(`Failed to reject match: ${error.message}`);
    }
};

// Refresh suggestions
window.refreshSuggestions = async function() {
    const btn = event?.target || document.querySelector('button[onclick="refreshSuggestions()"]');
    const originalText = btn.textContent;
    btn.textContent = 'Generating...';
    btn.disabled = true;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/matching/suggest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ maxPerRbt: 10 }),
        });
        
        const result = await response.json();
        
        if (!response.ok || result.error) {
            throw new Error(result.message || 'Failed to generate suggestions');
        }
        
        alert(`Generated ${result.total} match suggestions!`);
        loadPotentialMatches(currentMatchStatus);
        
    } catch (error) {
        console.error('Error refreshing suggestions:', error);
        alert(`Failed to generate suggestions: ${error.message}`);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
};

// Show potential match on map
window.showPotentialMatchOnMap = async function(matchId) {
    const match = potentialMatchesData.find(m => m.id === matchId);
    if (!match) {
        console.error('Match not found:', matchId);
        return;
    }
    
    const rbt = match.rbt_profiles;
    const client = match.clients;
    
    if (!rbt || !client || !rbt.lat || !rbt.lng || !client.lat || !client.lng) {
        alert('Location data missing for this match. Cannot display on map.');
        return;
    }
    
    // Clear existing connections
    clearConnections();
    
    try {
        const clientCoords = { lat: client.lat, lng: client.lng };
        const rbtCoords = { lat: rbt.lat, lng: rbt.lng };
        
        // Determine travel mode
        const travelMode = match.travel_mode || (rbt.transport_mode === 'Transit' ? 'transit' : 'driving');
        const modeForDirections = travelMode === 'transit' ? google.maps.TravelMode.TRANSIT : google.maps.TravelMode.DRIVING;
        
        // Get route from Directions API
        try {
            const route = await getDirectionsRoute(
                clientCoords,
                rbtCoords,
                travelMode
            );
            
            // Create DirectionsRenderer
            const directionsRenderer = new google.maps.DirectionsRenderer({
                map: map,
                directions: route,
                suppressMarkers: true, // We use our own markers
                polylineOptions: {
                    strokeColor: match.status === 'APPROVED' ? '#4CAF50' : match.status === 'PENDING' ? '#FF9800' : '#666666',
                    strokeWeight: 5,
                    strokeOpacity: 0.8
                }
            });
            
            directionsRenderers.push(directionsRenderer);
            
            // Get travel info from match data
            const rationale = match.rationale || {};
            const distance = rationale.distanceMiles || (match.distance_meters ? Math.round(match.distance_meters / 1609.34 * 10) / 10 : null);
            const travelTime = rationale.travelTimeMinutes || (match.travel_time_sec ? Math.round(match.travel_time_sec / 60) : null);
            
            // Add midpoint marker with travel info
            const midLat = (clientCoords.lat + rbtCoords.lat) / 2;
            const midLng = (clientCoords.lng + rbtCoords.lng) / 2;
            
            const connectionInfoWindow = new google.maps.InfoWindow({
                content: `
                    <div class="map-info-window" style="text-align: center; min-width: 200px;">
                        <p style="margin: 4px 0; font-size: 14px; font-weight: 600;">Potential Match</p>
                        <p style="margin: 4px 0; font-size: 12px; color: #666;">${client.name} → ${rbt.full_name || rbt.first_name + ' ' + rbt.last_name}</p>
                        <hr style="margin: 8px 0; border: none; border-top: 1px solid #eee;">
                        <p style="margin: 4px 0; font-size: 14px;">Score: <strong>${match.score.toFixed(1)}</strong></p>
                        ${distance ? `<p style="margin: 4px 0; font-size: 14px;">Distance: <strong>${distance.toFixed(1)} miles</strong></p>` : ''}
                        ${travelTime ? `<p style="margin: 4px 0; font-size: 14px;">Travel Time: <strong>${travelTime} minutes</strong></p>` : ''}
                        <p style="margin: 4px 0; font-size: 14px;">Mode: <strong>${travelMode === 'transit' ? 'Transit' : 'Driving'}</strong></p>
                        <p style="margin: 4px 0; font-size: 12px; color: ${match.status === 'APPROVED' ? '#4CAF50' : match.status === 'PENDING' ? '#FF9800' : '#666'}; font-weight: 600;">
                            Status: ${match.status}
                        </p>
                    </div>
                `,
                position: { lat: midLat, lng: midLng }
            });
            
            connectionInfoWindow.open(map);
            infoWindows.push(connectionInfoWindow);
            
            // Pan to show route
            map.fitBounds(route.routes[0].bounds);
            
        } catch (directionsError) {
            console.warn('Directions API failed, falling back to straight line:', directionsError);
            // Fallback to straight line
            const line = new google.maps.Polyline({
                path: [
                    new google.maps.LatLng(clientCoords.lat, clientCoords.lng),
                    new google.maps.LatLng(rbtCoords.lat, rbtCoords.lng)
                ],
                geodesic: true,
                strokeColor: match.status === 'APPROVED' ? '#4CAF50' : match.status === 'PENDING' ? '#FF9800' : '#666666',
                strokeOpacity: 0.8,
                strokeWeight: 5,
                zIndex: 50
            });
            line.setMap(map);
            lines.push(line);
            
            // Fit bounds
            const bounds = new google.maps.LatLngBounds();
            bounds.extend(clientCoords);
            bounds.extend(rbtCoords);
            map.fitBounds(bounds);
        }
        
    } catch (error) {
        console.error('Error showing potential match on map:', error);
        alert(`Error displaying match on map: ${error.message}`);
    }
};

// Setup match status filter buttons
function setupMatchStatusFilters() {
    document.querySelectorAll('.match-status-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.match-status-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMatchStatus = btn.dataset.status;
            loadPotentialMatches(currentMatchStatus);
        });
    });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
// Tab switching functionality
function switchTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(el => {
        el.classList.remove('active');
        el.classList.remove('border-rise-orange');
        el.classList.remove('text-rise-orange');
    });
    
    // Show selected tab
    const tabContent = document.getElementById(`tab-${tabName}`);
    const tabBtn = document.querySelector(`[data-tab="${tabName}"]`);
    
    if (tabContent) {
        tabContent.classList.remove('hidden');
    }
    if (tabBtn) {
        tabBtn.classList.add('active', 'border-rise-orange', 'text-rise-orange');
        tabBtn.style.borderBottomColor = '#FF6B35';
    }
    
    // Load tab-specific data
    if (tabName === 'unmatched') {
        loadUnmatched();
    } else if (tabName === 'locations') {
        loadLocationsNeedingVerification();
    } else if (tabName === 'suggestions') {
        // Potential matches already loaded
    } else if (tabName === 'simulation') {
        loadProposals('proposed');
        loadPairedClients();
    }
}

// Run matching job via API
async function runMatchingNow() {
    const btn = document.getElementById('run-matching-btn');
    const btnText = document.getElementById('run-matching-btn-text');
    const spinner = document.getElementById('run-matching-spinner');
    
    if (!btn || btn.disabled) return;
    
    btn.disabled = true;
    btnText.textContent = 'Running...';
    if (spinner) spinner.classList.remove('hidden');
    
    try {
        const API_BASE_URL = window.SCHEDULING_API_URL || 'http://localhost:3001';
        const response = await fetch(`${API_BASE_URL}/api/admin/matching/run-matching`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (result.error) {
            throw new Error(result.message || 'Failed to run matching');
        }
        
        // Update last run time
        if (result.summary && result.summary.generatedAt) {
            updateLastRunTime(result.summary.generatedAt);
        } else if (result.generatedAt) {
            updateLastRunTime(result.generatedAt);
        }
        
        // Reload data
        await refreshData();
        
        // Show success message
        const summary = result.summary || {};
        alert(`Matching completed!\n\nMatched: ${summary.matched || 0}\nStandby: ${summary.standby || 0}\nNo Location: ${summary.noLocation || 0}`);
    } catch (error) {
        console.error('Error running matching:', error);
        alert(`Failed to run matching: ${error.message}\n\nMake sure the API server is running on port 3001.`);
    } finally {
        btn.disabled = false;
        btnText.textContent = 'Run Matching Now';
        if (spinner) spinner.classList.add('hidden');
    }
}

// Make runMatchingNow available immediately
if (typeof window !== 'undefined') {
    window.runMatchingNow = runMatchingNow;
}

// Refresh data from matches_data.json
async function refreshData() {
    try {
        const response = await fetch('matches_data.json?t=' + Date.now());
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        matchesData = await response.json();
        
        // Re-render UI
        updateStats(); // Updates KPIs
        renderResults(); // Render match results
        renderRBTProfiles();
        renderClientProfiles();
        renderActivityLogs();
        if (map) {
            addMarkersAndLines();
        }
        
        console.log('✅ Data refreshed');
    } catch (error) {
        console.error('Error refreshing data:', error);
        alert(`Failed to refresh data: ${error.message}`);
    }
}

// Make refreshData available immediately
if (typeof window !== 'undefined') {
    window.refreshData = refreshData;
}

// Update last run time display
function updateLastRunTime(timestamp) {
    const el = document.getElementById('last-run-time');
    if (el && timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        
        if (diffMins < 1) {
            el.textContent = 'Just now';
        } else if (diffMins < 60) {
            el.textContent = `${diffMins} min ago`;
        } else if (diffMins < 1440) {
            const hours = Math.floor(diffMins / 60);
            el.textContent = `${hours} hour${hours > 1 ? 's' : ''} ago`;
        } else {
            el.textContent = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
    }
}

// Poll for matching status
function startStatusPolling() {
    const API_BASE_URL = window.SCHEDULING_API_URL || 'http://localhost:3001';
    
    // Try to fetch status immediately (but don't show errors if API is down)
    const fetchStatus = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/matching/matching-status`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                // Don't throw on network errors
            }).catch(() => null);
            
            if (response && response.ok) {
                const result = await response.json();
                if (result && result.lastRunAt) {
                    updateLastRunTime(result.lastRunAt);
                } else if (result && result.last_matching_run_at) {
                    updateLastRunTime(result.last_matching_run_at);
                }
            }
        } catch (error) {
            // Silently fail - API server might not be running, which is okay
            // Only log non-network errors
            if (error.message && !error.message.includes('fetch') && !error.message.includes('Failed')) {
                console.debug('Status polling error:', error);
            }
        }
    };
    
    // Fetch immediately
    fetchStatus();
    
    // Then poll every 60 seconds
    setInterval(fetchStatus, 60000);
}

// Load unmatched clients
async function loadUnmatched() {
    const listEl = document.getElementById('unmatched-list');
    if (!listEl) return;
    
    listEl.innerHTML = '<div class="text-center text-slate-500 py-8"><p>Loading unmatched clients...</p></div>';
    
    try {
        const API_BASE_URL = window.SCHEDULING_API_URL || 'http://localhost:3001';
        const response = await fetch(`${API_BASE_URL}/api/admin/matching/unmatched`);
        const result = await response.json();
        
        if (result.success && result.unmatched) {
            if (result.unmatched.length === 0) {
                listEl.innerHTML = '<div class="text-center text-slate-500 py-8"><p>No unmatched clients</p></div>';
                return;
            }
            
            listEl.innerHTML = result.unmatched.map(item => `
                <div class="border border-slate-200 rounded-lg p-4 mb-3 hover:shadow-md transition-shadow">
                    <div class="flex items-start justify-between mb-2">
                        <h4 class="font-semibold text-slate-900">${item.clientName || 'Unknown'}</h4>
                        <span class="px-2 py-1 text-xs font-medium rounded ${item.status === 'standby' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}">
                            ${item.status === 'standby' ? 'Standby' : 'No Location'}
                        </span>
                    </div>
                    <p class="text-sm text-slate-600 mb-2">${item.reason || 'No reason provided'}</p>
                    ${item.location ? `<p class="text-xs text-slate-500">Location: ${item.location}</p>` : ''}
                    ${item.needsLocationVerification ? '<p class="text-xs text-amber-600 mt-2">⚠️ Needs location verification</p>' : ''}
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading unmatched:', error);
        listEl.innerHTML = '<div class="text-center text-red-500 py-8"><p>Error loading unmatched clients</p></div>';
    }
}

// Load locations needing verification
function loadLocationsNeedingVerification() {
    const listEl = document.getElementById('locations-verify-list');
    if (!listEl || !matchesData) return;
    
    // Find clients and RBTs with bad/medium geocoding quality
    const needsVerification = [];
    
    // Check clients
    if (matchesData.clients) {
        matchesData.clients.forEach(client => {
            const quality = getLocationQuality(client.geocodePrecision, client.geocodeConfidence);
            if (quality === 'bad' || client.needsLocationVerification) {
                needsVerification.push({
                    type: 'client',
                    id: client.id,
                    name: client.name,
                    location: client.location,
                    precision: client.geocodePrecision || 'Unknown',
                    confidence: client.geocodeConfidence !== null && client.geocodeConfidence !== undefined ? client.geocodeConfidence : null,
                });
            }
        });
    }
    
    // Check RBTs
    if (matchesData.rbts) {
        matchesData.rbts.forEach(rbt => {
            const quality = getLocationQuality(rbt.geocodePrecision, rbt.geocodeConfidence);
            if (quality === 'bad') {
                needsVerification.push({
                    type: 'rbt',
                    id: rbt.id,
                    name: rbt.name,
                    location: rbt.location,
                    precision: rbt.geocodePrecision || 'Unknown',
                    confidence: rbt.geocodeConfidence !== null && rbt.geocodeConfidence !== undefined ? rbt.geocodeConfidence : null,
                });
            }
        });
    }
    
    if (needsVerification.length === 0) {
        listEl.innerHTML = '<div class="text-center text-slate-500 py-8"><p>No locations need verification</p></div>';
        return;
    }
    
    listEl.innerHTML = needsVerification.map(item => `
        <div class="border border-slate-200 rounded-lg p-4 mb-3 hover:shadow-md transition-shadow">
            <div class="flex items-start justify-between mb-2">
                <div>
                    <h4 class="font-semibold text-slate-900">${item.name || 'Unknown'}</h4>
                    <p class="text-xs text-slate-500 mt-1">${item.type === 'client' ? 'Client' : 'RBT'}</p>
                </div>
                <span class="px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-800">
                    ${item.precision}
                </span>
            </div>
            <p class="text-sm text-slate-600 mb-2">Location: ${item.location || 'Unknown'}</p>
            <p class="text-xs text-slate-500">Confidence: ${item.confidence !== null && item.confidence !== undefined ? (item.confidence * 100).toFixed(0) + '%' : 'Not set'}</p>
            <button onclick="verifyLocation('${item.type}', '${item.id}')" class="mt-3 px-3 py-1.5 text-xs font-medium text-white bg-rise-orange rounded-lg hover:bg-rise-orange-dark transition-colors">
                Verify Location
            </button>
        </div>
    `).join('');
}

// Toggle map type (placeholder)
function toggleMapType() {
    const textEl = document.getElementById('map-type-text');
    if (textEl) {
        textEl.textContent = textEl.textContent === 'Map' ? 'Satellite' : 'Map';
        // TODO: Implement map type toggle
    }
}

// renderKPIs is now consolidated into updateStats()

    document.addEventListener('DOMContentLoaded', () => {
        console.log('📄 DOM loaded, initializing...');
        init();
        setupMatchStatusFilters();
        startStatusPolling(); // Start polling for status updates
    });
} else {
    console.log('📄 DOM already ready, initializing...');
    init();
    setupMatchStatusFilters();
    startStatusPolling(); // Start polling for status updates
}

// ============================================================================
// SIMULATION WORKFLOW FUNCTIONS
// ============================================================================

const API_BASE_URL_SIM = window.SCHEDULING_API_URL || 'http://localhost:3001';

// Add client manually
async function addClient() {
    const nameInput = document.getElementById('client-name-input');
    const addressInput = document.getElementById('client-address-input');
    const notesInput = document.getElementById('client-notes-input');
    const btn = document.getElementById('add-client-btn');
    
    if (!nameInput || !addressInput || !btn) return;
    
    const name = nameInput.value.trim();
    const address = addressInput.value.trim();
    const notes = notesInput?.value.trim() || '';
    
    if (!name || !address) {
        alert('Name and address are required');
        return;
    }
    
    btn.disabled = true;
    btn.textContent = 'Adding...';
    
    try {
        const response = await fetch(`${API_BASE_URL_SIM}/api/admin/simulation/add-client`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, address, notes }),
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Failed to add client');
        }
        
        // Clear form
        nameInput.value = '';
        addressInput.value = '';
        if (notesInput) notesInput.value = '';
        
        alert(`Client "${data.client.name}" added successfully!`);
        
        // Refresh proposals if on simulation tab
        if (document.getElementById('tab-simulation') && !document.getElementById('tab-simulation').classList.contains('hidden')) {
            loadProposals('proposed');
        }
    } catch (error) {
        console.error('Error adding client:', error);
        alert(`Error: ${error instanceof Error ? error.message : 'Failed to add client'}`);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Add Client';
    }
}

// Run simulation
async function runSimulation() {
    const btn = document.getElementById('run-simulation-btn');
    const btnText = document.getElementById('run-simulation-btn-text');
    const spinner = document.getElementById('run-simulation-spinner');
    
    if (!btn || btn.disabled) return;
    
    if (!confirm('Run simulation to create proposals for unpaired clients?')) {
        return;
    }
    
    btn.disabled = true;
    if (btnText) btnText.textContent = 'Running...';
    if (spinner) spinner.classList.remove('hidden');
    
    try {
        const response = await fetch(`${API_BASE_URL_SIM}/api/admin/simulation/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Failed to run simulation');
        }
        
        alert(`Simulation complete!\n\nProposals created: ${data.proposals_created}\nClients processed: ${data.clients_processed}${data.errors.length > 0 ? `\nErrors: ${data.errors.length}` : ''}`);
        
        // Reload proposals
        loadProposals('proposed');
    } catch (error) {
        console.error('Error running simulation:', error);
        alert(`Error: ${error instanceof Error ? error.message : 'Failed to run simulation'}`);
    } finally {
        btn.disabled = false;
        if (btnText) btnText.textContent = 'Run Simulation';
        if (spinner) spinner.classList.add('hidden');
    }
}

// Load proposals
async function loadProposals(status = 'proposed') {
    const listEl = document.getElementById('proposals-list');
    if (!listEl) return;
    
    listEl.innerHTML = '<div class="text-center text-slate-500 py-8"><p>Loading proposals...</p></div>';
    
    try {
        const url = `${API_BASE_URL_SIM}/api/admin/simulation/proposals?status=${status}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Failed to load proposals');
        }
        
        if (!data.proposals || data.proposals.length === 0) {
            listEl.innerHTML = `<div class="text-center text-slate-500 py-8"><p>No ${status} proposals found.</p></div>`;
            return;
        }
        
        listEl.innerHTML = data.proposals.map((proposal: any) => {
            const client = proposal.client || {};
            const rbt = proposal.rbt || {};
            const travelTime = proposal.travel_time_minutes;
            const distance = proposal.distance_meters ? (proposal.distance_meters / 1609.34).toFixed(1) : 'N/A';
            
            let actionsHtml = '';
            if (status === 'proposed') {
                actionsHtml = `
                    <div class="flex gap-2 mt-3">
                        <button onclick="approveProposal('${proposal.id}')" class="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors">
                            Approve
                        </button>
                        <button onclick="rejectProposal('${proposal.id}')" class="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors">
                            Reject
                        </button>
                    </div>
                `;
            }
            
            return `
                <div class="border border-slate-200 rounded-lg p-4 mb-3 hover:shadow-md transition-shadow">
                    <div class="flex items-start justify-between mb-2">
                        <div class="flex-1">
                            <h4 class="font-semibold text-slate-900">${client.name || 'Unknown Client'}</h4>
                            <p class="text-xs text-slate-500 mt-1">Client</p>
                        </div>
                        <span class="px-2 py-1 text-xs font-medium rounded ${
                            status === 'proposed' ? 'bg-blue-100 text-blue-800' :
                            status === 'approved' ? 'bg-green-100 text-green-800' :
                            'bg-red-100 text-red-800'
                        }">
                            ${status.toUpperCase()}
                        </span>
                    </div>
                    <div class="mt-3 space-y-1 text-sm">
                        <p><span class="text-slate-600">RBT:</span> <span class="font-medium">${rbt.full_name || 'Unknown'}</span></p>
                        <p><span class="text-slate-600">Travel Time:</span> <span class="font-medium">${travelTime} min</span></p>
                        <p><span class="text-slate-600">Distance:</span> <span class="font-medium">${distance} mi</span></p>
                        <p class="text-xs text-slate-500 mt-2">Created: ${new Date(proposal.created_at).toLocaleString()}</p>
                    </div>
                    ${actionsHtml}
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading proposals:', error);
        listEl.innerHTML = `<div class="text-center text-red-500 py-8"><p>Error: ${error instanceof Error ? error.message : 'Failed to load proposals'}</p></div>`;
    }
}

// Approve proposal
async function approveProposal(proposalId: string) {
    if (!confirm('Approve this proposal? This will pair the client with the RBT and lock the RBT.')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL_SIM}/api/admin/simulation/approve/${proposalId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Failed to approve proposal');
        }
        
        alert('Proposal approved successfully!');
        loadProposals('proposed');
        loadPairedClients();
        refreshData(); // Refresh map
    } catch (error) {
        console.error('Error approving proposal:', error);
        alert(`Error: ${error instanceof Error ? error.message : 'Failed to approve proposal'}`);
    }
}

// Reject proposal
async function rejectProposal(proposalId: string) {
    if (!confirm('Reject this proposal? The client will remain unpaired.')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL_SIM}/api/admin/simulation/reject/${proposalId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Failed to reject proposal');
        }
        
        alert('Proposal rejected.');
        loadProposals('proposed');
    } catch (error) {
        console.error('Error rejecting proposal:', error);
        alert(`Error: ${error instanceof Error ? error.message : 'Failed to reject proposal'}`);
    }
}

// Load paired clients
async function loadPairedClients() {
    const listEl = document.getElementById('paired-clients-list');
    if (!listEl) return;
    
    listEl.innerHTML = '<div class="text-center text-slate-500 py-4">Loading...</div>';
    
    try {
        const response = await fetch(`${API_BASE_URL_SIM}/api/admin/simulation/paired`);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Failed to load paired clients');
        }
        
        if (!data.pairings || data.pairings.length === 0) {
            listEl.innerHTML = '<div class="text-center text-slate-500 py-4"><p>No paired clients yet.</p></div>';
            return;
        }
        
        listEl.innerHTML = data.pairings.map((pairing: any) => {
            const client = pairing.client || {};
            const rbt = pairing.rbt || {};
            
            return `
                <div class="border border-slate-200 rounded-lg p-4 mb-3 hover:shadow-md transition-shadow">
                    <div class="flex items-start justify-between mb-2">
                        <div class="flex-1">
                            <h4 class="font-semibold text-slate-900">${client.name || 'Unknown Client'}</h4>
                            <p class="text-xs text-slate-500 mt-1">Paired with ${rbt.full_name || 'Unknown RBT'}</p>
                        </div>
                        <span class="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800">
                            ACTIVE
                        </span>
                    </div>
                    <p class="text-xs text-slate-500 mt-2">Paired: ${new Date(pairing.created_at).toLocaleString()}</p>
                    <button onclick="reopenRBT('${pairing.rbt_id}', '${rbt.full_name}')" class="mt-3 px-3 py-1.5 text-xs font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors">
                        Reopen RBT
                    </button>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading paired clients:', error);
        listEl.innerHTML = `<div class="text-center text-red-500 py-4"><p>Error: ${error instanceof Error ? error.message : 'Failed to load paired clients'}</p></div>`;
    }
}

// Reopen RBT
async function reopenRBT(rbtId: string, rbtName?: string) {
    const name = rbtName || 'this RBT';
    if (!confirm(`Reopen ${name}? This will deactivate active pairings and make the RBT available for future simulations.`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL_SIM}/api/admin/rbts/${rbtId}/reopen`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Failed to reopen RBT');
        }
        
        alert(`RBT reopened successfully!\n\nPairings deactivated: ${data.pairings_deactivated}\nClients unpaired: ${data.clients_unpaired}`);
        loadPairedClients();
        loadProposals('proposed');
        refreshData(); // Refresh map
    } catch (error) {
        console.error('Error reopening RBT:', error);
        alert(`Error: ${error instanceof Error ? error.message : 'Failed to reopen RBT'}`);
    }
}

// Toggle section (for paired clients)
function toggleSection(sectionName: string) {
    const content = document.getElementById(`${sectionName}-content`);
    const icon = document.getElementById(`${sectionName}-icon`);
    
    if (content && icon) {
        const isHidden = content.classList.contains('hidden');
        if (isHidden) {
            content.classList.remove('hidden');
            icon.textContent = '▼';
            if (sectionName === 'paired') {
                loadPairedClients();
            }
        } else {
            content.classList.add('hidden');
            icon.textContent = '▶';
        }
    }
}

// Make functions globally available for onclick handlers
if (typeof window !== 'undefined') {
    window.runMatchingNow = runMatchingNow;
    window.switchTab = switchTab;
    window.refreshData = refreshData;
    window.loadUnmatched = loadUnmatched;
    window.loadLocationsNeedingVerification = loadLocationsNeedingVerification;
    window.toggleMapType = toggleMapType;
    window.toggleShowAllRoutes = toggleShowAllRoutes;
    window.showConnectionsForMatch = showConnectionsForMatch;
    window.selectMatchCard = selectMatchCard;
    // Simulation functions
    window.addClient = addClient;
    window.runSimulation = runSimulation;
    window.loadProposals = loadProposals;
    window.approveProposal = approveProposal;
    window.rejectProposal = rejectProposal;
    window.loadPairedClients = loadPairedClients;
    window.reopenRBT = reopenRBT;
    window.toggleSection = toggleSection;
}
// refreshSuggestions is already defined above, just assign it
if (typeof refreshSuggestions !== 'undefined') {
    window.refreshSuggestions = refreshSuggestions;
}

