import { type SessionStatus } from "../api/client";
import { WeekView } from "./WeekView";

// Booking several courts at once is what an officer does; which roles those are is the club's own
// decision, so it is derived from holding anything beyond MEMBER rather than from a list of ours.
function holdsAnOfficeBeyondMembership(session: SessionStatus): boolean {
  return session.roles.some((role) => role !== "MEMBER");
}

export function HomeView({ session }: { session: SessionStatus }) {
  return <section data-testid="court-plan-view" className="surface-panel w-full max-w-7xl self-start rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <WeekView canBook={session.authenticated} canChooseSeveralCourts={holdsAnOfficeBeyondMembership(session)} />
  </section>;
}
