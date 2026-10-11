import type { SessionStatus } from "../api/client";

export function reachesAdministration(session: SessionStatus): boolean {
  return session.roles.includes("ADMIN") || Boolean(session.managesAppointments) || Boolean(session.createsSeries);
}
