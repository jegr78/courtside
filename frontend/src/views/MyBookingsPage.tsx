import { useTranslation } from "react-i18next";
import { type SessionStatus } from "../api/client";
import { MyBookingsView } from "./MyBookingsView";

export function MyBookingsPage({ session, offline = false }: { session: SessionStatus; offline?: boolean }) {
  const { t } = useTranslation();
  return <section data-testid="my-bookings-page" className="surface-panel w-full max-w-7xl self-start rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    {session.displayName && <p className="text-muted">{t("home.welcome", { name: session.displayName })}</p>}
    <MyBookingsView showManaged={session.roles.some((role) => role !== "MEMBER")} offline={offline} />
  </section>;
}
