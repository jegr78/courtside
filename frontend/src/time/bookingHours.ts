import type { BookingHours } from "../api/client";

export function leavesBookingHours(slot: string, slotMinutes: number, hours: BookingHours): boolean {
  return minutesOf(slot) < minutesOf(hours.earliestStart) || minutesOf(slot) + slotMinutes > minutesOf(hours.latestEnd);
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}
