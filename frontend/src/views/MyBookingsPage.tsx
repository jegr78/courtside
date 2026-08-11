import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { api, type SessionStatus } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { MyBookingsView } from "./MyBookingsView";

export function MyBookingsPage({ session, signedOut }: { session: SessionStatus; signedOut: () => void }) {
  const { t } = useTranslation();
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

  return <section data-testid="my-bookings-page" className="surface-panel w-full max-w-7xl self-start rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <nav aria-label={t("nav.primary")} className="flex flex-wrap items-center gap-4">
        <NavLink to="/" data-testid="court-plan-link" className="font-semibold underline-offset-4">{t("nav.courts")}</NavLink>
        <NavLink to="/my-bookings" data-testid="my-bookings-link" className="underline-offset-4">{t("nav.myBookings")}</NavLink>
      </nav>
      <Button type="button" data-testid="logout" onClick={() => void logout()}>{t("auth.logout")}</Button>
    </div>
    <p className="text-muted mt-4">{t("home.welcome", { name: session.displayName })}</p>
    {error && <Alert>{error}</Alert>}
    <MyBookingsView showManaged={session.roles.some((role) => role !== "MEMBER")} />
  </section>;
}
