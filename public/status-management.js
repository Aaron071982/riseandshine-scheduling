/**
 * Status Management Component with Confirmation
 * 
 * This component ensures status changes only occur after explicit confirmation.
 * Prevents accidental status changes that could trigger emails or notifications.
 */

// State management
let pendingStatusChange = {
    rbtId: null,
    newStatus: null,
    oldStatus: null,
    confirmed: false
};

/**
 * Initialize status management for an RBT
 * @param {string} rbtId - The RBT ID
 * @param {string} currentStatus - Current status of the RBT
 */
function initStatusManagement(rbtId, currentStatus) {
    // Reset any pending changes
    pendingStatusChange = {
        rbtId: null,
        newStatus: null,
        oldStatus: null,
        confirmed: false
    };
    
    // Set up event listeners
    setupStatusDropdown(rbtId, currentStatus);
    setupActionButtons(rbtId, currentStatus);
}

/**
 * Set up the status dropdown - only stores selection, doesn't change status
 */
function setupStatusDropdown(rbtId, currentStatus) {
    const statusDropdown = document.getElementById('status-dropdown');
    if (!statusDropdown) return;
    
    // Store current status
    pendingStatusChange.oldStatus = currentStatus;
    pendingStatusChange.rbtId = rbtId;
    
    // When dropdown changes, only update the pending status (not the actual status)
    statusDropdown.addEventListener('change', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const selectedStatus = e.target.value;
        
        // Only store the selection - don't change status yet
        pendingStatusChange.newStatus = selectedStatus;
        pendingStatusChange.confirmed = false;
        
        // Show confirmation UI
        showStatusConfirmation(selectedStatus, currentStatus);
        
        // Prevent any automatic status change
        return false;
    });
    
    // Prevent form submission on Enter
    statusDropdown.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    });
}

/**
 * Show confirmation UI when status is selected
 */
function showStatusConfirmation(newStatus, oldStatus) {
    // Remove any existing confirmation UI
    const existingConfirm = document.getElementById('status-confirmation-panel');
    if (existingConfirm) {
        existingConfirm.remove();
    }
    
    // Create confirmation panel
    const confirmationPanel = document.createElement('div');
    confirmationPanel.id = 'status-confirmation-panel';
    confirmationPanel.className = 'status-confirmation-panel';
    confirmationPanel.innerHTML = `
        <div class="status-confirmation-content">
            <div class="status-confirmation-header">
                <h4>Confirm Status Change</h4>
            </div>
            <div class="status-confirmation-body">
                <p class="status-change-preview">
                    <span class="status-label">Current Status:</span>
                    <span class="status-value old-status">${oldStatus}</span>
                </p>
                <p class="status-change-preview">
                    <span class="status-label">New Status:</span>
                    <span class="status-value new-status">${newStatus}</span>
                </p>
                ${newStatus === 'HIRED' ? `
                <div class="status-warning">
                    <strong>⚠️ Important:</strong> This will trigger a "Hired" email notification. 
                    Only confirm if the candidate has been fully hired.
                </div>
                ` : ''}
            </div>
            <div class="status-confirmation-actions">
                <button 
                    type="button"
                    onclick="confirmStatusChange()" 
                    class="btn-confirm-status"
                    id="confirm-status-btn">
                    Confirm Change
                </button>
                <button 
                    type="button"
                    onclick="cancelStatusChange()" 
                    class="btn-cancel-status"
                    id="cancel-status-btn">
                    Cancel
                </button>
            </div>
        </div>
    `;
    
    // Insert after status dropdown
    const statusSection = document.querySelector('.status-management-section');
    if (statusSection) {
        statusSection.appendChild(confirmationPanel);
    } else {
        // Fallback: insert after dropdown
        const dropdown = document.getElementById('status-dropdown');
        if (dropdown && dropdown.parentElement) {
            dropdown.parentElement.appendChild(confirmationPanel);
        }
    }
    
    // Reset dropdown to old status (visual only)
    const dropdown = document.getElementById('status-dropdown');
    if (dropdown) {
        dropdown.value = oldStatus;
    }
}

/**
 * Confirm the status change - this is the ONLY place status actually changes
 */
async function confirmStatusChange() {
    if (!pendingStatusChange.rbtId || !pendingStatusChange.newStatus) {
        console.error('No pending status change to confirm');
        return;
    }
    
    if (pendingStatusChange.confirmed) {
        console.warn('Status change already confirmed');
        return;
    }
    
    // Mark as confirmed
    pendingStatusChange.confirmed = true;
    
    // Disable buttons during processing
    const confirmBtn = document.getElementById('confirm-status-btn');
    const cancelBtn = document.getElementById('cancel-status-btn');
    if (confirmBtn) confirmBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    
    try {
        // Actually update the status in the database
        await updateRBTStatus(
            pendingStatusChange.rbtId,
            pendingStatusChange.newStatus
        );
        
        // Show success message
        showStatusChangeSuccess(pendingStatusChange.newStatus);
        
        // Remove confirmation panel
        const confirmationPanel = document.getElementById('status-confirmation-panel');
        if (confirmationPanel) {
            confirmationPanel.remove();
        }
        
        // Reset pending change
        pendingStatusChange = {
            rbtId: null,
            newStatus: null,
            oldStatus: null,
            confirmed: false
        };
        
        // Reload RBT data to reflect new status
        if (typeof reloadRBTData === 'function') {
            reloadRBTData();
        }
        
    } catch (error) {
        console.error('Error updating status:', error);
        alert('Failed to update status. Please try again.');
        
        // Re-enable buttons
        if (confirmBtn) confirmBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        
        pendingStatusChange.confirmed = false;
    }
}

/**
 * Cancel the status change
 */
function cancelStatusChange() {
    // Reset dropdown to old status
    const dropdown = document.getElementById('status-dropdown');
    if (dropdown && pendingStatusChange.oldStatus) {
        dropdown.value = pendingStatusChange.oldStatus;
    }
    
    // Remove confirmation panel
    const confirmationPanel = document.getElementById('status-confirmation-panel');
    if (confirmationPanel) {
        confirmationPanel.remove();
    }
    
    // Reset pending change
    pendingStatusChange = {
        rbtId: null,
        newStatus: null,
        oldStatus: null,
        confirmed: false
    };
}

/**
 * Update RBT status in Supabase
 */
async function updateRBTStatus(rbtId, newStatus) {
    // This should call your actual API endpoint
    // Example implementation:
    
    const response = await fetch('/api/rbts/update-status', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            rbtId: rbtId,
            status: newStatus
        })
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update status');
    }
    
    return await response.json();
}

/**
 * Show success message
 */
function showStatusChangeSuccess(newStatus) {
    const successMsg = document.createElement('div');
    successMsg.className = 'status-success-message';
    successMsg.textContent = `Status successfully changed to: ${newStatus}`;
    
    const statusSection = document.querySelector('.status-management-section');
    if (statusSection) {
        statusSection.appendChild(successMsg);
        
        // Remove after 3 seconds
        setTimeout(() => {
            successMsg.remove();
        }, 3000);
    }
}

/**
 * Set up action buttons (Mark as Hired, Reject, Delete)
 * These also require confirmation
 */
function setupActionButtons(rbtId, currentStatus) {
    // Mark as Hired button
    const markHiredBtn = document.getElementById('mark-hired-btn');
    if (markHiredBtn) {
        markHiredBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            // Set pending status to HIRED
            pendingStatusChange.rbtId = rbtId;
            pendingStatusChange.newStatus = 'HIRED';
            pendingStatusChange.oldStatus = currentStatus;
            pendingStatusChange.confirmed = false;
            
            // Show confirmation
            showStatusConfirmation('HIRED', currentStatus);
            
            return false;
        });
    }
    
    // Reject Candidate button
    const rejectBtn = document.getElementById('reject-candidate-btn');
    if (rejectBtn) {
        rejectBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            // Set pending status to REJECTED
            pendingStatusChange.rbtId = rbtId;
            pendingStatusChange.newStatus = 'REJECTED';
            pendingStatusChange.oldStatus = currentStatus;
            pendingStatusChange.confirmed = false;
            
            // Show confirmation
            showStatusConfirmation('REJECTED', currentStatus);
            
            return false;
        });
    }
    
    // Delete RBT button (separate confirmation)
    const deleteBtn = document.getElementById('delete-rbt-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            // Show delete confirmation (separate from status change)
            showDeleteConfirmation(rbtId);
            
            return false;
        });
    }
}

/**
 * Show delete confirmation
 */
function showDeleteConfirmation(rbtId) {
    const confirmed = confirm(
        '⚠️ WARNING: This action cannot be undone.\n\n' +
        'All RBT data will be permanently deleted.\n\n' +
        'Are you sure you want to delete this RBT?'
    );
    
    if (confirmed) {
        // Second confirmation for safety
        const doubleConfirm = confirm(
            'This is your final warning.\n\n' +
            'Click OK to permanently delete this RBT.'
        );
        
        if (doubleConfirm) {
            deleteRBT(rbtId);
        }
    }
}

/**
 * Delete RBT (only called after double confirmation)
 */
async function deleteRBT(rbtId) {
    try {
        const response = await fetch(`/api/rbts/${rbtId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            throw new Error('Failed to delete RBT');
        }
        
        alert('RBT successfully deleted.');
        
        // Reload or redirect
        if (typeof reloadRBTData === 'function') {
            reloadRBTData();
        } else {
            window.location.reload();
        }
        
    } catch (error) {
        console.error('Error deleting RBT:', error);
        alert('Failed to delete RBT. Please try again.');
    }
}

// Make functions globally available
window.initStatusManagement = initStatusManagement;
window.confirmStatusChange = confirmStatusChange;
window.cancelStatusChange = cancelStatusChange;

