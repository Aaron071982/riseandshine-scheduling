import { RBTProfile, ClientProfile, MatchResult, TimeSlot } from "./models";
import { isTravelFeasible } from "./location";
import { estimateTravelTime, isTravelTimeAcceptable, calculateTravelTimeScore } from "./travelTime";

/**
 * Checks if two time slots overlap.
 */
function slotsOverlap(slot1: TimeSlot, slot2: TimeSlot): boolean {
  if (slot1.day !== slot2.day) {
    return false;
  }
  
  const slot1End = slot1.startHour + slot1.durationHours;
  const slot2End = slot2.startHour + slot2.durationHours;
  
  // Check if there's any overlap
  return !(slot1End <= slot2.startHour || slot2End <= slot1.startHour);
}

/**
 * Finds overlapping time slots between client requests and RBT availability.
 */
function findOverlappingSlots(
  clientSlots: TimeSlot[],
  rbtAvailableSlots: TimeSlot[],
  rbtAssignedSlots: TimeSlot[]
): TimeSlot[] {
  const overlapping: TimeSlot[] = [];
  
  // Get available slots (not yet assigned)
  const availableSlots = rbtAvailableSlots.filter(slot => {
    return !rbtAssignedSlots.some(assigned => slotsOverlap(slot, assigned));
  });
  
  for (const clientSlot of clientSlots) {
    for (const rbtSlot of availableSlots) {
      if (slotsOverlap(clientSlot, rbtSlot)) {
        // Use the client's slot preference, but ensure it fits in RBT's availability
        const overlapStart = Math.max(clientSlot.startHour, rbtSlot.startHour);
        const overlapEnd = Math.min(
          clientSlot.startHour + clientSlot.durationHours,
          rbtSlot.startHour + rbtSlot.durationHours
        );
        const overlapDuration = overlapEnd - overlapStart;
        
        if (overlapDuration > 0) {
          overlapping.push({
            day: clientSlot.day,
            startHour: overlapStart,
            durationHours: overlapDuration
          });
        }
      }
    }
  }
  
  // Remove duplicates (same day and start hour)
  const unique: TimeSlot[] = [];
  for (const slot of overlapping) {
    if (!unique.some(s => s.day === slot.day && s.startHour === slot.startHour)) {
      unique.push(slot);
    }
  }
  
  return unique;
}

/**
 * Calculates total hours from time slots.
 */
export function calculateHours(slots: TimeSlot[]): number {
  return slots.reduce((total, slot) => total + slot.durationHours, 0);
}

/**
 * Formats time slots as human-readable string.
 */
export function formatTimeSlots(slots: TimeSlot[]): string {
  if (slots.length === 0) {
    return "none";
  }
  
  // Group by day
  const byDay: Record<string, TimeSlot[]> = {};
  for (const slot of slots) {
    if (!byDay[slot.day]) {
      byDay[slot.day] = [];
    }
    byDay[slot.day].push(slot);
  }
  
  const parts: string[] = [];
  const dayOrder: TimeSlot["day"][] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  
  for (const day of dayOrder) {
    if (byDay[day]) {
      const daySlots = byDay[day].sort((a, b) => a.startHour - b.startHour);
      const ranges: string[] = [];
      
      for (const slot of daySlots) {
        const start = slot.startHour;
        const end = slot.startHour + slot.durationHours;
        const startStr = start < 12 ? `${start} AM` : start === 12 ? "12 PM" : `${start - 12} PM`;
        const endStr = end < 12 ? `${end} AM` : end === 12 ? "12 PM" : `${end - 12} PM`;
        ranges.push(`${startStr}-${endStr}`);
      }
      
      parts.push(`${day} ${ranges.join(", ")}`);
    }
  }
  
  return parts.join("; ");
}

/**
 * Core matching algorithm: matches clients to RBTs based on travel feasibility and schedule overlap.
 */
export function matchClientsToRBTs(
  clients: ClientProfile[],
  rbts: RBTProfile[]
): MatchResult[] {
  const results: MatchResult[] = [];
  
  // Reset assigned slots for all RBTs
  for (const rbt of rbts) {
    rbt.assignedSlots = [];
  }
  
  for (const client of clients) {
    // Step 1: Filter RBTs by travel feasibility
    const feasibleRBTs = rbts.filter(rbt => isTravelFeasible(rbt, client));
    
    if (feasibleRBTs.length === 0) {
      results.push({
        clientId: client.id,
        clientName: client.name,
        clientLocation: client.locationBorough,
        authorizedWeeklyHours: client.authorizedWeeklyHours,
        rbtId: null,
        rbtName: null,
        rbtLocation: null,
        rbtTransportMode: null,
        matchedSlots: [],
        matchedHours: 0,
        status: "pending",
        reason: `No compatible RBT in travel range (client in ${client.locationBorough})`
      });
      continue;
    }
    
    // Step 2: Find best matching RBT based on schedule overlap AND travel time
    let bestRBT: RBTProfile | null = null;
    let bestOverlapSlots: TimeSlot[] = [];
    let bestOverlapHours = 0;
    let bestScore = Infinity; // Lower is better
    
    for (const rbt of feasibleRBTs) {
      const overlapSlots = findOverlappingSlots(
        client.requestedSlots,
        rbt.availableSlots,
        rbt.assignedSlots
      );
      const overlapHours = calculateHours(overlapSlots);
      
      // Skip if no schedule overlap
      if (overlapHours === 0) continue;
      
      // Calculate travel time
      const travelTime = estimateTravelTime(
        rbt.locationBorough,
        client.locationBorough,
        rbt.transportMode
      );
      
      // Check if travel time is acceptable for this transport mode
      if (!isTravelTimeAcceptable(travelTime, rbt.transportMode)) {
        continue; // Skip RBTs that don't meet travel time requirements
      }
      
      // Calculate travel time score (lower = better)
      const travelScore = calculateTravelTimeScore(travelTime, rbt.transportMode);
      const currentAssignedHours = calculateHours(rbt.assignedSlots);
      
      // Combined score: prioritize schedule overlap, then travel time, then fairness
      // Lower score = better match
      const score = 
        (1000 - overlapHours * 10) + // Schedule overlap is most important (inverted, so lower is better)
        travelScore * 2 + // Travel time score
        currentAssignedHours * 0.1; // Fairness (slight preference for less busy RBTs)
      
      if (score < bestScore) {
        bestRBT = rbt;
        bestOverlapSlots = overlapSlots;
        bestOverlapHours = overlapHours;
        bestScore = score;
      }
    }
    
    // Step 3: Assign slots up to authorized hours
    if (bestRBT && bestOverlapHours > 0) {
      // Limit to authorized hours
      let assignedSlots: TimeSlot[] = [];
      let assignedHours = 0;
      
      for (const slot of bestOverlapSlots) {
        if (assignedHours + slot.durationHours <= client.authorizedWeeklyHours) {
          assignedSlots.push(slot);
          assignedHours += slot.durationHours;
        } else {
          // Partial slot if we're close to limit
          const remainingHours = client.authorizedWeeklyHours - assignedHours;
          if (remainingHours > 0 && slot.durationHours > remainingHours) {
            assignedSlots.push({
              day: slot.day,
              startHour: slot.startHour,
              durationHours: remainingHours
            });
            assignedHours = client.authorizedWeeklyHours;
          }
          break;
        }
      }
      
      // Mark slots as assigned for this RBT
      bestRBT.assignedSlots.push(...assignedSlots);
      
      // Determine status and reason
      let status: "matched" | "pending" = "matched";
      let reason: string | undefined;
      
      if (assignedHours < client.authorizedWeeklyHours) {
        reason = `Matched ${assignedHours}/${client.authorizedWeeklyHours} hours (partial match)`;
      } else {
        reason = `Full match (${assignedHours} hours)`;
      }
      
      results.push({
        clientId: client.id,
        clientName: client.name,
        clientLocation: client.locationBorough,
        authorizedWeeklyHours: client.authorizedWeeklyHours,
        rbtId: bestRBT.id,
        rbtName: bestRBT.name,
        rbtLocation: bestRBT.locationBorough,
        rbtTransportMode: bestRBT.transportMode,
        matchedSlots: assignedSlots,
        matchedHours: assignedHours,
        status,
        reason
      });
    } else {
      // No overlap found
      results.push({
        clientId: client.id,
        clientName: client.name,
        clientLocation: client.locationBorough,
        authorizedWeeklyHours: client.authorizedWeeklyHours,
        rbtId: null,
        rbtName: null,
        rbtLocation: null,
        rbtTransportMode: null,
        matchedSlots: [],
        matchedHours: 0,
        status: "pending",
        reason: "No schedule overlap with feasible RBTs"
      });
    }
  }
  
  return results;
}
