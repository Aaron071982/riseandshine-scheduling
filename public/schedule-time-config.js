// Schedule Time Configuration
// Restricts scheduling to after-school hours: 3PM - 9PM

const SCHEDULE_CONFIG = {
    // After-school hours only
    startHour: 15, // 3PM (24-hour format)
    endHour: 21,   // 9PM (24-hour format)
    timeSlotDuration: 60, // 1 hour slots in minutes
    daysOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
};

// Generate available time slots for a given day
function generateTimeSlots(date) {
    const slots = [];
    const day = new Date(date);
    
    for (let hour = SCHEDULE_CONFIG.startHour; hour < SCHEDULE_CONFIG.endHour; hour++) {
        const startTime = new Date(day);
        startTime.setHours(hour, 0, 0, 0);
        
        const endTime = new Date(day);
        endTime.setHours(hour + 1, 0, 0, 0);
        
        slots.push({
            start: startTime,
            end: endTime,
            startFormatted: formatTime(startTime),
            endFormatted: formatTime(endTime),
            available: true
        });
    }
    
    return slots;
}

// Format time as 3:00 PM - 4:00 PM
function formatTime(date) {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const displayMinutes = minutes.toString().padStart(2, '0');
    return `${displayHours}:${displayMinutes} ${ampm}`;
}

// Check if a time is within allowed hours
function isTimeAllowed(date) {
    const hour = date.getHours();
    return hour >= SCHEDULE_CONFIG.startHour && hour < SCHEDULE_CONFIG.endHour;
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SCHEDULE_CONFIG, generateTimeSlots, formatTime, isTimeAllowed };
} else {
    window.SCHEDULE_CONFIG = SCHEDULE_CONFIG;
    window.generateTimeSlots = generateTimeSlots;
    window.formatTime = formatTime;
    window.isTimeAllowed = isTimeAllowed;
}

