import { parse } from "csv-parse/sync";
import * as fs from "fs";
import * as path from "path";
import { RBTProfile, ClientProfile, TimeSlot, DayOfWeek } from "./models";
import { normalizeBorough } from "./location";

/**
 * Generates a placeholder schedule for RBTs.
 * Default: Weekdays 9 AM - 6 PM (9 hours/day × 5 days = 45 hours/week capacity)
 * Extended hours to ensure better matching
 * 
 * TODO: Replace with real schedule data from CSV or database
 */
function generateRBTPlaceholderSchedule(): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const weekdays: DayOfWeek[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  
  for (const day of weekdays) {
    // 9 AM to 6 PM, 1-hour blocks (extended to 6 PM for better matching)
    for (let hour = 9; hour < 18; hour++) {
      slots.push({
        day,
        startHour: hour,
        durationHours: 1
      });
    }
  }
  
  return slots;
}

/**
 * Generates a placeholder schedule for clients.
 * Default: Weekday afternoons 1 PM - 6 PM (5 hours/day × 5 days = 25 hours/week capacity)
 * Extended hours to ensure better matching with RBTs
 * 
 * TODO: Replace with real schedule data from CSV or database
 */
function generateClientPlaceholderSchedule(): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const weekdays: DayOfWeek[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  
  for (const day of weekdays) {
    // 1 PM to 6 PM, 1-hour blocks (extended to ensure overlap with RBT schedules)
    for (let hour = 13; hour < 18; hour++) {
      slots.push({
        day,
        startHour: hour,
        durationHours: 1
      });
    }
  }
  
  return slots;
}

/**
 * Loads and parses RBT CSV file.
 * Note: RBT CSV has no header row, so we parse with column indices.
 */
export function loadRBTs(csvPath: string): RBTProfile[] {
  const fileContent = fs.readFileSync(csvPath, "utf-8");
  const records = parse(fileContent, {
    columns: true, // Has header row
    skip_empty_lines: true,
    trim: true
  });
  
  const rbts: RBTProfile[] = [];
  let idCounter = 1;
  
  for (const record of records) {
    // RBT CSV structure: RBTs, Status, Date Added/ Updates, Phone number, Location, Email, Transport Mode
    const name = record["RBTs"] || "";
    if (!name || name.trim() === "") {
      continue;
    }
    
    // Extract location/borough
    const locationText = record["Location"] || "";
    const borough = normalizeBorough(locationText);
    
    // Extract transport mode
    const transportModeText = (record["Transport Mode"] || record["TransportMode"] || "Either").trim();
    let transportMode: "Car" | "PublicTransit" | "Either" = "Either";
    if (transportModeText.toLowerCase() === "car") {
      transportMode = "Car";
    } else if (transportModeText.toLowerCase() === "publictransit" || transportModeText.toLowerCase() === "public transit") {
      transportMode = "PublicTransit";
    } else {
      transportMode = "Either";
    }
    
    // Generate placeholder schedule
    // TODO: Parse real schedule from CSV if available
    const availableSlots = generateRBTPlaceholderSchedule();
    
    const rbt: RBTProfile = {
      id: `rbt-${idCounter++}`,
      name: name.trim(),
      locationBorough: borough !== "Unknown" ? borough : "Brooklyn", // Default to Brooklyn if unknown
      transportMode,
      availableSlots,
      maxWeeklyHours: 40, // Increased capacity for better matching
      assignedSlots: [] // Initially empty
    };
    
    rbts.push(rbt);
  }
  
  return rbts;
}

/**
 * Loads and parses Clients CSV file.
 */
export function loadClients(csvPath: string): ClientProfile[] {
  const fileContent = fs.readFileSync(csvPath, "utf-8");
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
  
  const clients: ClientProfile[] = [];
  let idCounter = 1;
  
  for (const record of records) {
    // Skip rows with empty client names
    const name = record["Clients"] || record["Client"] || "";
    if (!name || name.trim() === "") {
      continue;
    }
    
    // Extract location/borough
    const locationText = record["Location"] || record["location"] || "";
    let borough = normalizeBorough(locationText);
    
    // If borough is unknown, assign a default based on common patterns or default to Brooklyn
    if (borough === "Unknown") {
      // Try to infer from other data or default to Brooklyn
      borough = "Brooklyn"; // Default location for clients without specified location
    }
    
    // Generate placeholder schedule
    // TODO: Parse real schedule from CSV if available
    const requestedSlots = generateClientPlaceholderSchedule();
    
    const client: ClientProfile = {
      id: `client-${idCounter++}`,
      name: name.trim(),
      locationBorough: borough,
      authorizedWeeklyHours: 20, // Default assumption
      requestedSlots
    };
    
    clients.push(client);
  }
  
  return clients;
}
