/**
 * Simplified Scheduling AI Frontend
 * 
 * Features:
 * - Map showing all RBTs
 * - Client entry form
 * - Simulation with match results
 * - Approve functionality
 */

const API_BASE_URL = window.SCHEDULING_API_URL || 'http://localhost:3001';

// Global state
let map = null;
let rbtMarkers = [];
let clientMarker = null;
let directionsRenderer = null;
let currentProposal = null;
let approvedPairings = []; // Track approved matches for map display

// Initialize when Google Maps loads
window.addEventListener('google-maps-loaded', () => {
    initMap();
    loadRBTs();
    loadApprovedPairings(); // Load approved matches on startup
});

// Initialize map
function initMap() {
    if (typeof google === 'undefined' || !google.maps) {
        console.error('Google Maps not available');
        return;
    }

    map = new google.maps.Map(document.getElementById('map'), {
        zoom: 11,
        center: { lat: 40.6782, lng: -73.9442 }, // Brooklyn/Queens area
        styles: [
            {
                featureType: "poi",
                elementType: "labels",
                stylers: [{ visibility: "off" }]
            }
        ]
    });

    console.log('✅ Map initialized');
}

// Load all RBTs and display on map
async function loadRBTs() {
    try {
        console.log('Loading RBTs from:', `${API_BASE_URL}/api/admin/rbts`);
        let response = await fetch(`${API_BASE_URL}/api/admin/rbts`);
        let data = await response.json();

        console.log('RBTs API response:', data);

        let rbts = data.rbts || [];
        
        if (rbts.length === 0) {
            console.log('No RBTs found anywhere');
            document.getElementById('results-container').innerHTML = `
                <div class="text-center text-amber-600 py-8">
                    <p>⚠️ No RBTs with coordinates found</p>
                    <p class="text-xs mt-2">RBTs need to be geocoded to appear on the map.</p>
                    <p class="text-xs mt-1">Run: <code class="bg-slate-100 px-1 rounded">npm run geocode-rbts</code></p>
                </div>
            `;
            return;
        }

        console.log(`Found ${rbts.length} RBTs to display`);

        // Clear existing markers
        rbtMarkers.forEach(m => m.setMap(null));
        rbtMarkers = [];

        console.log(`Found ${data.rbts.length} RBTs, checking for coordinates...`);

        const bounds = new google.maps.LatLngBounds();

        // Add markers for each RBT
        let rbtCount = 0;
        let rbtWithoutCoords = 0;
        
        rbts.forEach(rbt => {
            // Handle both old format (rbt.name) and new format (rbt.full_name)
            const rbtName = rbt.full_name || rbt.name || 'Unknown';
            const rbtLat = rbt.lat;
            const rbtLng = rbt.lng;
            
            if (rbtLat && rbtLng) {
                rbtCount++;
                const position = { lat: parseFloat(rbtLat), lng: parseFloat(rbtLng) };
                bounds.extend(position);

                // Different color for available vs locked (default to available if not set)
                const availabilityStatus = rbt.availability_status || 'available';
                const isAvailable = availabilityStatus === 'available';
                const fillColor = isAvailable ? '#666666' : '#FF9800'; // Grey for available, orange for locked

                const marker = new google.maps.Marker({
                    position: position,
                    map: map,
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 12,
                        fillColor: fillColor,
                        fillOpacity: 1,
                        strokeColor: '#FFFFFF',
                        strokeWeight: 2
                    },
                    title: `${rbtName} (${availabilityStatus})`
                });

                const statusText = isAvailable ? 'Available' : 'Locked';
                const statusColor = isAvailable ? '#4CAF50' : '#FF9800';

                const infoWindow = new google.maps.InfoWindow({
                    content: `
                        <div style="padding: 8px;">
                            <h3 style="margin: 0 0 4px 0; font-weight: 600;">${rbtName}</h3>
                            <p style="margin: 0; font-size: 12px; color: ${statusColor}; font-weight: 600;">Status: ${statusText}</p>
                            ${rbt.location ? `<p style="margin: 4px 0 0 0; font-size: 11px; color: #666;">${rbt.location}</p>` : ''}
                        </div>
                    `
                });

                marker.addListener('click', () => {
                    infoWindow.open(map, marker);
                });

                rbtMarkers.push(marker);
            } else {
                rbtWithoutCoords++;
                console.log(`RBT ${rbtName} missing coordinates`);
            }
        });

        console.log(`RBTs with coordinates: ${rbtCount}, without: ${rbtWithoutCoords}`);

        // Fit map to show all RBTs
        if (rbtMarkers.length > 0) {
            map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
        }

        if (rbtMarkers.length === 0) {
            console.warn('No RBTs with valid coordinates found');
            document.getElementById('results-container').innerHTML = `
                <div class="text-center text-amber-600 py-8">
                    <p>⚠️ No RBTs with coordinates found</p>
                    <p class="text-xs mt-2">RBTs need to be geocoded to appear on the map</p>
                </div>
            `;
        }
        
        // Update RBT count in header
        const countEl = document.getElementById('rbt-count');
        if (countEl) {
            countEl.textContent = rbtMarkers.length.toString();
        }
        
        console.log(`✅ Loaded ${rbtMarkers.length} RBTs on map`);
    } catch (error) {
        console.error('Error loading RBTs:', error);
        document.getElementById('results-container').innerHTML = `
            <div class="text-center text-red-600 py-8">
                <p>❌ Error loading RBTs</p>
                <p class="text-xs mt-2">${error.message}</p>
            </div>
        `;
    }
}

// Handle client form submission
document.getElementById('client-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('client-name').value.trim();
    const address = document.getElementById('client-address').value.trim();
    const zip = document.getElementById('client-zip').value.trim();

    if (!name || !address || !zip) {
        alert('Please fill in all required fields');
        return;
    }

    // Combine address and zip
    const fullAddress = `${address}, ${zip}`;

    const btn = document.getElementById('add-client-btn');
    btn.disabled = true;
    btn.textContent = 'Adding...';

    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/simulation/add-client`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, address: fullAddress })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Failed to add client');
        }

        // Clear form
        document.getElementById('client-form').reset();

        // Show client on map
        if (data.client.lat && data.client.lng) {
            showClientOnMap(data.client);
        }

        alert(`Client "${data.client.name}" added successfully!`);
    } catch (error) {
        console.error('Error adding client:', error);
        alert(`Error: ${error.message}`);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Add Client';
    }
});

// Show client on map
function showClientOnMap(client) {
    // Clear existing client marker
    if (clientMarker) {
        clientMarker.setMap(null);
    }

    if (!client.lat || !client.lng) {
        return;
    }

    const position = { lat: client.lat, lng: client.lng };

    clientMarker = new google.maps.Marker({
        position: position,
        map: map,
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 14,
            fillColor: '#FF6B35',
            fillOpacity: 1,
            strokeColor: '#FFFFFF',
            strokeWeight: 3
        },
        title: client.name
    });

    // Center map on client
    map.setCenter(position);
    map.setZoom(13);

    const infoWindow = new google.maps.InfoWindow({
        content: `
            <div style="padding: 8px;">
                <h3 style="margin: 0 0 4px 0; font-weight: 600; color: #FF6B35;">${client.name}</h3>
                <p style="margin: 0; font-size: 12px; color: #666;">${client.address || 'No address'}</p>
            </div>
        `
    });

    clientMarker.addListener('click', () => {
        infoWindow.open(map, clientMarker);
    });
}

// Run simulation
async function runSimulation() {
    const btn = document.getElementById('run-simulation-btn');
    const statusEl = document.getElementById('simulation-status');
    
    btn.disabled = true;
    btn.textContent = 'Running...';
    statusEl.textContent = 'Running simulation...';

    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/simulation/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Failed to run simulation');
        }

        if (data.proposals_created > 0) {
            statusEl.textContent = `✅ Simulation complete: ${data.proposals_created} proposal(s) created`;
            // Load and display proposals only if matches were found
            await loadProposals();
        } else {
            statusEl.textContent = `⚠️ No matches found within 30 minutes travel time`;
            document.getElementById('results-container').innerHTML = `
                <div class="text-center py-8">
                    <div class="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-3">
                        <span class="text-amber-600 text-3xl">⚠️</span>
                    </div>
                    <p class="text-amber-700 font-semibold mb-2">No matches found</p>
                    <p class="text-sm text-slate-600">No RBTs found within 30 minutes travel time for this client.</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error running simulation:', error);
        statusEl.textContent = `Error: ${error.message}`;
        alert(`Error: ${error.message}`);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Run Simulation';
    }
}

// Load proposals and display results
async function loadProposals() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/simulation/proposals?status=proposed`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Failed to load proposals');
        }

        const container = document.getElementById('results-container');

        if (!data.proposals || data.proposals.length === 0) {
            container.innerHTML = `
                <div class="text-center text-slate-500 py-8">
                    <p>No proposals found. Run simulation to create matches.</p>
                </div>
            `;
            return;
        }

        // Show the first proposal (most recent)
        const proposal = data.proposals[0];
        currentProposal = proposal;

        const client = proposal.client || {};
        const rbt = proposal.rbt || {};
        const travelTime = proposal.travel_time_minutes;
        const distance = proposal.distance_meters ? (proposal.distance_meters / 1609.34).toFixed(1) : 'N/A';

        container.innerHTML = `
            <div class="bg-gradient-to-br from-white to-slate-50 border-2 border-slate-200 rounded-xl p-5 shadow-lg">
                <div class="flex items-center gap-2 mb-4">
                    <div class="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                        <span class="text-blue-600 text-xl">🎯</span>
                    </div>
                    <h3 class="text-lg font-bold text-slate-900">Match Found</h3>
                </div>
                
                <div class="space-y-4 mb-5">
                    <div class="bg-white rounded-lg p-3 border border-slate-200">
                        <p class="text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Client</p>
                        <p class="text-base font-semibold text-slate-900">${client.name || 'Unknown'}</p>
                        <p class="text-xs text-slate-600 mt-1">${client.address || ''}</p>
                    </div>
                    
                    <div class="bg-white rounded-lg p-3 border border-slate-200">
                        <p class="text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">RBT</p>
                        <p class="text-base font-semibold text-slate-900">${rbt.full_name || 'Unknown'}</p>
                    </div>
                    
                    <div class="grid grid-cols-2 gap-3">
                        <div class="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-3 border border-blue-200">
                            <p class="text-xs font-semibold text-blue-600 mb-1 uppercase tracking-wide">Travel Time</p>
                            <p class="text-xl font-bold text-blue-900">${travelTime} min</p>
                        </div>
                        <div class="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-3 border border-purple-200">
                            <p class="text-xs font-semibold text-purple-600 mb-1 uppercase tracking-wide">Distance</p>
                            <p class="text-xl font-bold text-purple-900">${distance} mi</p>
                        </div>
                    </div>
                </div>
                
                <div class="flex gap-2">
                    <button onclick="approveProposal()" 
                            class="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-green-600 to-green-700 rounded-lg hover:shadow-md transition-all">
                        ✓ Approve
                    </button>
                    <button onclick="deferProposal()" 
                            class="px-4 py-2.5 text-sm font-semibold text-amber-700 bg-amber-100 rounded-lg hover:bg-amber-200 transition-all">
                        ⏸ Stall
                    </button>
                    <button onclick="rejectProposal()" 
                            class="px-4 py-2.5 text-sm font-semibold text-red-700 bg-red-100 rounded-lg hover:bg-red-200 transition-all">
                        ✗ Reject
                    </button>
                </div>
            </div>
        `;

        // Show connection on map
        if (client.lat && client.lng && rbt.lat && rbt.lng) {
            showConnectionOnMap(
                { lat: client.lat, lng: client.lng },
                { lat: rbt.lat, lng: rbt.lng },
                client.name,
                rbt.full_name,
                travelTime,
                distance
            );
        }
    } catch (error) {
        console.error('Error loading proposals:', error);
        document.getElementById('results-container').innerHTML = `
            <div class="text-center text-red-500 py-8">
                <p>Error: ${error.message}</p>
            </div>
        `;
    }
}

// Show connection line on map
function showConnectionOnMap(clientPos, rbtPos, clientName, rbtName, travelTime, distance, isApproved = false) {
    // Don't clear existing directions if showing approved (we want multiple lines)
    if (!isApproved && directionsRenderer) {
        directionsRenderer.setMap(null);
    }

    const directionsService = new google.maps.DirectionsService();
    
    directionsService.route({
        origin: rbtPos,
        destination: clientPos,
        travelMode: google.maps.TravelMode.DRIVING
    }, (result, status) => {
        if (status === 'OK' && result) {
            const renderer = new google.maps.DirectionsRenderer({
                map: map,
                directions: result,
                suppressMarkers: true,
                polylineOptions: {
                    strokeColor: isApproved ? '#10B981' : '#4CAF50', // Darker green for approved
                    strokeWeight: isApproved ? 6 : 5,
                    strokeOpacity: isApproved ? 1.0 : 0.8,
                    zIndex: isApproved ? 1000 : 100
                }
            });
            
            // Store renderer for approved pairings
            if (isApproved) {
                if (!window.approvedRenderers) window.approvedRenderers = [];
                window.approvedRenderers.push(renderer);
            } else {
                directionsRenderer = renderer;
            }

            // Only fit bounds for current proposal (not approved ones)
            if (!isApproved) {
                const bounds = new google.maps.LatLngBounds();
                bounds.extend(clientPos);
                bounds.extend(rbtPos);
                map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
            }

            // Add info window at midpoint
            const midLat = (clientPos.lat + rbtPos.lat) / 2;
            const midLng = (clientPos.lng + rbtPos.lng) / 2;

            const statusText = isApproved ? '<span style="color: #10B981; font-weight: 600;">✓ APPROVED</span>' : '';
            const infoWindow = new google.maps.InfoWindow({
                content: `
                    <div style="padding: 8px; text-align: center; min-width: 200px;">
                        <p style="margin: 0 0 8px 0; font-weight: 600;">${rbtName} → ${clientName}</p>
                        ${statusText ? `<p style="margin: 4px 0; font-size: 12px;">${statusText}</p>` : ''}
                        ${travelTime ? `<p style="margin: 4px 0; font-size: 13px;"><strong>Travel Time:</strong> ${travelTime} min</p>` : ''}
                        ${distance ? `<p style="margin: 4px 0; font-size: 13px;"><strong>Distance:</strong> ${distance} mi</p>` : ''}
                    </div>
                `,
                position: { lat: midLat, lng: midLng }
            });

            // Only open info window for current proposal, not approved ones
            if (!isApproved) {
                infoWindow.open(map);
            }
        } else {
            console.error('Directions request failed:', status);
        }
    });
}

// Approve proposal
async function approveProposal() {
    if (!currentProposal) {
        alert('No proposal to approve');
        return;
    }

    if (!confirm('Approve this match? This will pair the client with the RBT.')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/simulation/approve/${currentProposal.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Failed to approve proposal');
        }

        // Show success message
        document.getElementById('results-container').innerHTML = `
            <div class="text-center py-8">
                <div class="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                    <span class="text-green-600 text-3xl">✓</span>
                </div>
                <p class="text-green-700 font-semibold">Match approved successfully!</p>
            </div>
        `;

        // Clear connection line
        if (directionsRenderer) {
            directionsRenderer.setMap(null);
            directionsRenderer = null;
        }

        // Reload RBTs to reflect availability changes
        await loadRBTs();
        
        // Load approved pairings to show on map
        await loadApprovedPairings();
        
        // Reload history
        if (document.getElementById('results-history').classList.contains('hidden') === false) {
            loadHistory('all');
        }
        
        currentProposal = null;
    } catch (error) {
        console.error('Error approving proposal:', error);
        alert(`Error: ${error.message}`);
    }
}

// Defer proposal (stall)
async function deferProposal() {
    if (!currentProposal) {
        alert('No proposal to defer');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/simulation/defer/${currentProposal.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Failed to defer proposal');
        }

        // Show success message
        document.getElementById('results-container').innerHTML = `
            <div class="text-center py-8">
                <div class="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-3">
                    <span class="text-amber-600 text-3xl">⏸</span>
                </div>
                <p class="text-amber-700 font-semibold">Proposal deferred for later review</p>
            </div>
        `;

        // Clear connection line
        if (directionsRenderer) {
            directionsRenderer.setMap(null);
            directionsRenderer = null;
        }

        // Reload history
        if (document.getElementById('results-history').classList.contains('hidden') === false) {
            loadHistory('deferred');
        }
        
        currentProposal = null;
    } catch (error) {
        console.error('Error deferring proposal:', error);
        alert(`Error: ${error.message}`);
    }
}

// Reject proposal
async function rejectProposal() {
    if (!currentProposal) {
        alert('No proposal to reject');
        return;
    }

    if (!confirm('Reject this proposal? The client will remain unpaired.')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/simulation/reject/${currentProposal.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Failed to reject proposal');
        }

        // Show success message
        document.getElementById('results-container').innerHTML = `
            <div class="text-center py-8">
                <div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">
                    <span class="text-red-600 text-3xl">✗</span>
                </div>
                <p class="text-red-700 font-semibold">Proposal rejected</p>
            </div>
        `;

        // Clear connection line
        if (directionsRenderer) {
            directionsRenderer.setMap(null);
            directionsRenderer = null;
        }

        // Reload history
        if (document.getElementById('results-history').classList.contains('hidden') === false) {
            loadHistory('rejected');
        }
        
        currentProposal = null;
    } catch (error) {
        console.error('Error rejecting proposal:', error);
        alert(`Error: ${error.message}`);
    }
}

// Switch results tab
function switchResultsTab(tab) {
    const currentTab = document.getElementById('results-current');
    const historyTab = document.getElementById('results-history');
    const currentBtn = document.getElementById('tab-current');
    const historyBtn = document.getElementById('tab-history');
    
    if (tab === 'current') {
        currentTab.classList.remove('hidden');
        historyTab.classList.add('hidden');
        currentBtn.classList.add('border-rise-orange', 'text-slate-700');
        currentBtn.classList.remove('border-transparent', 'text-slate-500');
        historyBtn.classList.remove('border-rise-orange', 'text-slate-700');
        historyBtn.classList.add('border-transparent', 'text-slate-500');
    } else {
        currentTab.classList.add('hidden');
        historyTab.classList.remove('hidden');
        historyBtn.classList.add('border-rise-orange', 'text-slate-700');
        historyBtn.classList.remove('border-transparent', 'text-slate-500');
        currentBtn.classList.remove('border-rise-orange', 'text-slate-700');
        currentBtn.classList.add('border-transparent', 'text-slate-500');
        loadHistory('all');
    }
}

// Load history
async function loadHistory(status = 'all') {
    const container = document.getElementById('history-container');
    container.innerHTML = '<div class="text-center text-slate-500 py-8"><p class="text-sm">Loading history...</p></div>';
    
    try {
        let url = `${API_BASE_URL}/api/admin/simulation/proposals`;
        if (status !== 'all') {
            url += `?status=${status}`;
        }
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Failed to load history');
        }
        
        // Filter to non-proposed statuses for history
        let proposals = data.proposals || [];
        if (status === 'all') {
            proposals = proposals.filter(p => p.status !== 'proposed');
        }
        
        if (proposals.length === 0) {
            container.innerHTML = `
                <div class="text-center text-slate-500 py-8">
                    <p class="text-sm">No ${status === 'all' ? '' : status} history found</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = proposals.map(proposal => {
            const client = proposal.client || {};
            const rbt = proposal.rbt || {};
            const travelTime = proposal.travel_time_minutes;
            const distance = proposal.distance_meters ? (proposal.distance_meters / 1609.34).toFixed(1) : 'N/A';
            
            const statusColors = {
                approved: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', icon: '✓' },
                rejected: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', icon: '✗' },
                deferred: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', icon: '⏸' }
            };
            
            const statusStyle = statusColors[proposal.status] || statusColors.approved;
            
            return `
                <div class="bg-white border ${statusStyle.border} rounded-lg p-4 mb-3 ${statusStyle.bg} shadow-sm hover:shadow-md transition-all">
                    <div class="flex items-start justify-between mb-2">
                        <div class="flex-1">
                            <div class="flex items-center gap-2 mb-1">
                                <span class="text-lg">${statusStyle.icon}</span>
                                <h4 class="font-semibold text-slate-900">${client.name || 'Unknown'}</h4>
                            </div>
                            <p class="text-xs text-slate-600 mb-1">${client.address || ''}</p>
                            <p class="text-sm font-medium text-slate-700">RBT: ${rbt.full_name || 'Unknown'}</p>
                        </div>
                        <span class="px-2.5 py-1 text-xs font-semibold rounded-lg ${statusStyle.bg} ${statusStyle.text} border ${statusStyle.border}">
                            ${proposal.status.toUpperCase()}
                        </span>
                    </div>
                    <div class="flex gap-4 text-xs mt-3 pt-3 border-t ${statusStyle.border}">
                        <div>
                            <span class="text-slate-500">Travel:</span>
                            <span class="font-semibold text-slate-900 ml-1">${travelTime} min</span>
                        </div>
                        <div>
                            <span class="text-slate-500">Distance:</span>
                            <span class="font-semibold text-slate-900 ml-1">${distance} mi</span>
                        </div>
                        <div class="ml-auto text-slate-400">
                            ${new Date(proposal.created_at).toLocaleDateString()}
                        </div>
                    </div>
                    ${proposal.status === 'deferred' ? `
                        <div class="mt-3 flex gap-2">
                            <button onclick="approveDeferredProposal('${proposal.id}')" 
                                    class="flex-1 px-3 py-1.5 text-xs font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors">
                                Approve Now
                            </button>
                            <button onclick="rejectDeferredProposal('${proposal.id}')" 
                                    class="px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-100 rounded-lg hover:bg-red-200 transition-colors">
                                Reject
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading history:', error);
        container.innerHTML = `
            <div class="text-center text-red-500 py-8">
                <p>Error: ${error.message}</p>
            </div>
        `;
    }
}

// Approve deferred proposal
async function approveDeferredProposal(proposalId) {
    if (!confirm('Approve this deferred proposal?')) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/simulation/approve/${proposalId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Failed to approve');
        
        loadHistory('all');
        await loadRBTs();
        alert('Proposal approved!');
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
}

// Reject deferred proposal
async function rejectDeferredProposal(proposalId) {
    if (!confirm('Reject this deferred proposal?')) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/simulation/reject/${proposalId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Failed to reject');
        
        loadHistory('all');
        alert('Proposal rejected');
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
}

// Load approved pairings and show on map
async function loadApprovedPairings() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/simulation/paired`);
        const data = await response.json();
        
        if (!response.ok || !data.pairings || data.pairings.length === 0) {
            approvedPairings = [];
            return;
        }
        
        approvedPairings = data.pairings;
        
        // Show approved pairings on map
        approvedPairings.forEach(pairing => {
            const client = pairing.client;
            const rbt = pairing.rbt;
            
            if (client && rbt && client.lat && client.lng && rbt.lat && rbt.lng) {
                // Show connection line for approved pairing
                showConnectionOnMap(
                    { lat: client.lat, lng: client.lng },
                    { lat: rbt.lat, lng: rbt.lng },
                    client.name,
                    rbt.full_name,
                    0, // Travel time not needed for approved
                    null,
                    true // Mark as approved
                );
            }
        });
        
        console.log(`✅ Loaded ${approvedPairings.length} approved pairings on map`);
    } catch (error) {
        console.error('Error loading approved pairings:', error);
    }
}

// Make functions globally available
window.runSimulation = runSimulation;
window.approveProposal = approveProposal;
window.deferProposal = deferProposal;
window.rejectProposal = rejectProposal;
window.switchResultsTab = switchResultsTab;
window.loadHistory = loadHistory;
window.approveDeferredProposal = approveDeferredProposal;
window.rejectDeferredProposal = rejectDeferredProposal;
