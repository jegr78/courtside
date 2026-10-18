import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { type SessionStatus } from "../api/client";
import { useHasDependants } from "../navigation/dependants";
import { MyBookingsView } from "./MyBookingsView";

export function MyBookingsPage({ session, offline = false }: { session: SessionStatus; offline?: boolean }) {
  const { t } = useTranslation();
  const hasDependants = useHasDependants(session.authenticated && !offline, "/my-bookings");
  return <section data-testid="my-bookings-page" className="surface-panel w-full max-w-7xl self-start rounded-2xl border p-4 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    {session.displayName && <p className="text-muted">{t("home.welcome", { name: session.displayName })}</p>}
    {hasDependants && <Link to="/my-dependants" data-testid="my-dependants-shortcut"
      className="focus-ring mt-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-4">{t("dependants.title")}</Link>}
    <MyBookingsView offline={offline} />
  </section>;
}
