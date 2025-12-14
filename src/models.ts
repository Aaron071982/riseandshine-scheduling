export type DayOfWeek = "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat";

export interface TimeSlot {
  day: DayOfWeek;
  startHour: number; // e.g. 9..17 (9 AM to 5 PM)
  durationHours: number; // typically 1
}

export interface RBTProfile {
  id: string;
  name: string;
  locationBorough: string; // e.g. "Brooklyn", "Queens", "Bronx", etc.
  transportMode: "Car" | "PublicTransit" | "Either";
  availableSlots: TimeSlot[]; // normalized schedule
  maxWeeklyHours: number; // assume 20 or 30 if not in data
  assignedSlots: TimeSlot[]; // tracks slots already assigned to clients
}

export interface ClientProfile {
  id: string;
  name: string;
  locationBorough: string;
  authorizedWeeklyHours: number; // assume 20 hours/week if not in data
  requestedSlots: TimeSlot[]; // normalized session request schedule
}

export interface MatchResult {
  clientId: string;
  clientName: string;
  clientLocation: string;
  authorizedWeeklyHours: number;
  rbtId: string | null;
  rbtName: string | null;
  rbtLocation: string | null;
  rbtTransportMode: "Car" | "PublicTransit" | "Either" | null;
  matchedSlots: TimeSlot[]; // slots assigned
  matchedHours: number;
  status: "matched" | "pending";
  reason?: string; // if pending, explain why
}
