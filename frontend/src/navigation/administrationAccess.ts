import type { SessionStatus } from "../api/client";

export function reachesAdministration(session: SessionStatus): boolean {
  return session.roles.includes("ADMIN") || session.roles.includes("TREASURER")
    || session.roles.includes("GROUNDSKEEPER") || Boolean(session.managesAppointments) || Boolean(session.createsSeries);
}

export function readsGuestFees(session: SessionStatus): boolean {
  return session.roles.includes("ADMIN") || session.roles.includes("TREASURER");
}

export function readsAccessCodes(session: SessionStatus): boolean {
  return session.roles.includes("ADMIN") || session.roles.includes("GROUNDSKEEPER");
}
