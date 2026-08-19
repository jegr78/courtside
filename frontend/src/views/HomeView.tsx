import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, useLocation } from "react-router-dom";
import { api, type SessionStatus } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { WeekView } from "./WeekView";

export function HomeView({ session, signedOut }: { session: SessionStatus; signedOut: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  const [error, setError] = useState<string>();
  async function logout() {
    setError(undefined);
    try {
      await api.logout();
      signedOut();
    } catch (failure) {
      setError(problemMessage(failure, t));
    }
  }
  return <section data-testid="court-plan-view" className="surface-panel w-full max-w-7xl self-start rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <nav aria-label={t("nav.primary")} className="flex flex-wrap items-center gap-4">
        <Link to="/" data-testid="court-plan-link" aria-current={["/", "/courts"].includes(location.pathname) ? "page" : undefined} className="font-semibold underline-offset-4">{t("nav.courts")}</Link>
        {session.authenticated && <NavLink to="/my-bookings" data-testid="my-bookings-link" className="underline-offset-4">{t("nav.myBookings")}</NavLink>}
        {session.roles.includes("ADMIN") && <NavLink to="/admin/configuration" data-testid="admin-configuration-link" className="underline-offset-4">{t("nav.adminConfiguration")}</NavLink>}
        {session.roles.includes("ADMIN") && <NavLink to="/admin/facility" data-testid="admin-facility-link" className="underline-offset-4">{t("nav.adminFacility")}</NavLink>}
        {session.roles.includes("ADMIN") && <NavLink to="/admin/roster" data-testid="admin-roster-link" className="underline-offset-4">{t("nav.adminRoster")}</NavLink>}
      </nav>
      {session.authenticated
        ? <Button type="button" data-testid="logout" onClick={() => void logout()}>{t("auth.logout")}</Button>
        : <Link to="/login" data-testid="sign-in-link" className="rounded-lg bg-(--club-primary) px-4 py-3 font-semibold text-(--club-primary-text)">{t("auth.submit")}</Link>}
    </div>
    {error && <Alert>{error}</Alert>}
    <WeekView canBook={session.authenticated} />
  </section>;
}
