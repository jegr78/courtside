import { useTranslation } from "react-i18next";
import { type SessionStatus } from "../api/client";
import { useClubConfiguration } from "../club/registry";
import { WeekView } from "./WeekView";

// Booking several courts at once is what an officer does; which roles those are is the club's own
// decision, so it is derived from holding anything beyond MEMBER or EXTERNAL rather than a list of ours.
function holdsAnOfficeBeyondMembership(session: SessionStatus): boolean {
  return session.roles.some((role) => role !== "MEMBER" && role !== "EXTERNAL");
}

export function HomeView({ session, offline = false }: {
  session: SessionStatus; offline?: boolean;
}) {
  const { t } = useTranslation();
  const { club } = useClubConfiguration();

  return <section data-testid="court-plan-view" className="surface-panel w-full max-w-7xl self-start rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    {!session.authenticated && <p data-testid="guest-guidance" className="mb-6 rounded-xl border px-4 py-3">
      {t("home.guestGuidance")}
    </p>}
    <WeekView canBook={session.authenticated} canChooseSeveralCourts={holdsAnOfficeBeyondMembership(session)}
      offline={offline} currency={club?.currency} memberFeatures={session.memberFeatures !== false} />
  </section>;
}
