import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { type SessionStatus } from "../api/client";
import { WeekView } from "./WeekView";

// Booking several courts at once is what an officer does; which roles those are is the club's own
// decision, so it is derived from holding anything beyond MEMBER rather than from a list of ours.
function holdsAnOfficeBeyondMembership(session: SessionStatus): boolean {
  return session.roles.some((role) => role !== "MEMBER");
}

export function HomeView({ session, offline = false }: {
  session: SessionStatus; offline?: boolean;
}) {
  const { t } = useTranslation();

  return <section data-testid="court-plan-view" className="surface-panel w-full max-w-7xl self-start rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    {!session.authenticated && <div data-testid="guest-guidance"
      className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
      <p className="min-w-0">{t("home.guestGuidance")}</p>
      <Link to="/login" data-testid="guest-sign-in" className="button-primary focus-ring rounded-lg px-4 py-2 font-semibold">
        {t("auth.submit")}
      </Link>
    </div>}
    <WeekView canBook={session.authenticated} canChooseSeveralCourts={holdsAnOfficeBeyondMembership(session)}
      offline={offline} />
  </section>;
}
