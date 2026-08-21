import { type SessionStatus } from "../api/client";
import { WeekView } from "./WeekView";

export function HomeView({ session }: { session: SessionStatus }) {
  return <section data-testid="court-plan-view" className="surface-panel w-full max-w-7xl self-start rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <WeekView canBook={session.authenticated} />
  </section>;
}
