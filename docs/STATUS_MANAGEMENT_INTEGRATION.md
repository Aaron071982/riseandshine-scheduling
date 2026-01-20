# Status Management Integration Guide

## Problem Solved

This component fixes the issue where status changes were happening immediately without confirmation, potentially triggering emails (like "Hired" notifications) before the admin intended.

## Solution

**Status changes now require explicit confirmation** - the status only changes when the user clicks "Confirm Change". Until then, the status remains unchanged.

---

## How to Integrate

### 1. Add CSS File

Add to your HTML `<head>`:

```html
<link rel="stylesheet" href="status-management.css">
```

### 2. Add JavaScript File

Add before closing `</body>`:

```html
<script src="status-management.js"></script>
```

### 3. Update Your Status Management HTML

Replace your current status management section with this structure:

```html
<div class="status-management-section">
    <h3>Status Management</h3>
    
    <!-- Status Dropdown -->
    <div style="margin-bottom: 16px;">
        <label for="status-dropdown" style="display: block; margin-bottom: 8px; font-weight: 500;">
            Change Status:
        </label>
        <select id="status-dropdown" name="status">
            <option value="INTERVIEW_SCHEDULED">Interview Scheduled</option>
            <option value="INTERVIEW_COMPLETED">Interview Completed</option>
            <option value="HIRED">Hired</option>
            <option value="ONBOARDING">Onboarding</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="REJECTED">Rejected</option>
        </select>
    </div>
    
    <!-- Action Buttons -->
    <div style="display: flex; gap: 12px; margin-bottom: 16px;">
        <button id="mark-hired-btn" type="button">
            Mark as Hired
        </button>
        <button id="reject-candidate-btn" type="button">
            Reject Candidate
        </button>
    </div>
    
    <!-- Delete Button -->
    <div>
        <button id="delete-rbt-btn" type="button">
            🗑️ Delete RBT
        </button>
        <p style="font-size: 12px; color: #64748b; margin-top: 8px;">
            This action cannot be undone. All RBT data will be permanently deleted.
        </p>
    </div>
    
    <!-- Confirmation panel will appear here automatically -->
</div>
```

### 4. Initialize on Page Load

When the RBT profile page loads, initialize the status management:

```javascript
// Get current RBT data
const rbtId = 'your-rbt-id'; // From your data
const currentStatus = 'INTERVIEW_COMPLETED'; // Current status from database

// Initialize status management
initStatusManagement(rbtId, currentStatus);
```

---

## How It Works

### Status Change Flow

1. **User selects new status** from dropdown
   - Status is NOT changed yet
   - Selection is stored in `pendingStatusChange`
   - Dropdown visually resets to old status

2. **Confirmation panel appears**
   - Shows current status vs. new status
   - Special warning for "HIRED" status
   - Two buttons: "Confirm Change" and "Cancel"

3. **User clicks "Confirm Change"**
   - Only NOW does the status actually change
   - API call is made to update database
   - Success message is shown
   - Page reloads/updates to reflect new status

4. **User clicks "Cancel"**
   - Pending change is discarded
   - Dropdown returns to original status
   - No changes are made

### Action Buttons Flow

- **"Mark as Hired"** button → Sets pending status to "HIRED" → Shows confirmation
- **"Reject Candidate"** button → Sets pending status to "REJECTED" → Shows confirmation
- **"Delete RBT"** button → Shows double confirmation dialog → Only deletes if both confirmed

---

## API Endpoint Required

You need to create this API endpoint in your backend:

```typescript
// POST /api/rbts/update-status
export async function POST(request: Request) {
  const { rbtId, status } = await request.json();
  
  // Update in Supabase
  const { data, error } = await supabase
    .from('rbt_profiles')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', rbtId)
    .select()
    .single();
    
  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  
  // If status is HIRED, trigger email (only after confirmed update)
  if (status === 'HIRED') {
    await sendHiredEmail(data.email, data.firstName);
  }
  
  return Response.json({ success: true, data });
}
```

---

## Key Safety Features

1. **No Immediate Changes**: Status dropdown changes are visual only until confirmed
2. **Explicit Confirmation**: User must click "Confirm Change" button
3. **Visual Feedback**: Clear indication of what will change
4. **Special Warnings**: Extra warning for "HIRED" status
5. **Double Confirmation**: Delete requires two confirmations
6. **Error Handling**: Failed updates don't change status

---

## Testing

1. Select a status from dropdown → Should show confirmation panel
2. Click "Cancel" → Status should remain unchanged
3. Click "Confirm Change" → Status should update
4. Try "Mark as Hired" button → Should show confirmation with warning
5. Try "Delete RBT" → Should require double confirmation

---

## Customization

### Change Confirmation Message

Edit `showStatusConfirmation()` function in `status-management.js`:

```javascript
function showStatusConfirmation(newStatus, oldStatus) {
    // Customize the confirmation message here
    const customMessage = `Are you sure you want to change status from ${oldStatus} to ${newStatus}?`;
    // ...
}
```

### Add More Status Options

Update the dropdown options in your HTML and ensure your API handles them.

### Customize Styling

Edit `status-management.css` to match your brand colors.

---

## Troubleshooting

**Issue**: Status changes immediately without confirmation
- **Fix**: Make sure `status-management.js` is loaded and `initStatusManagement()` is called

**Issue**: Confirmation panel doesn't appear
- **Fix**: Check browser console for errors, ensure `.status-management-section` exists in HTML

**Issue**: API call fails
- **Fix**: Verify API endpoint exists and returns proper JSON response

---

## Notes

- This component prevents ALL automatic status changes
- Status only changes when `confirmStatusChange()` is explicitly called
- The dropdown value resets to old status until confirmation
- All action buttons go through the same confirmation flow

