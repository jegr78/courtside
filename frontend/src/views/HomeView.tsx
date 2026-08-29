import { useTranslation } from "react-i18next";
import { type SessionStatus } from "../api/client";
import { WeekView } from "./WeekView";

// Booking several courts at once is what an officer does; which roles those are is the club's own
// decision, so it is derived from holding anything beyond MEMBER rather than from a list of ours.
function holdsAnOfficeBeyondMembership(session: SessionStatus): boolean {
  return session.roles.some((role) => role !== "MEMBER");
}

export function HomeView({ session, clubName }: { session: SessionStatus; clubName?: string }) {
  const { t } = useTranslation();

  return <section data-testid="court-plan-view" className="surface-panel w-full max-w-7xl self-start rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    {!session.authenticated && clubName && <div className="mb-6 grid gap-2">
      <h1 data-testid="public-club-name" className="text-3xl font-bold">
        {t("home.publicTitle", { clubName })}
      </h1>
      <p data-testid="guest-guidance" className="text-muted">{t("home.guestGuidance")}</p>
    </div>}
    <WeekView canBook={session.authenticated} canChooseSeveralCourts={holdsAnOfficeBeyondMembership(session)} />
  </section>;
}
