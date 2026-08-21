import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { api, type SessionStatus } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "./Alert";
import { Button } from "./Button";

interface Destination {
  to: string;
  testId: string;
  label: string;
  visible: (session: SessionStatus) => boolean;
}

const isAdmin = (session: SessionStatus) => session.roles.includes("ADMIN");

const destinations: Destination[] = [
  { to: "/", testId: "court-plan-link", label: "nav.courts", visible: () => true },
  { to: "/my-bookings", testId: "my-bookings-link", label: "nav.myBookings", visible: (session) => session.authenticated },
  { to: "/admin/configuration", testId: "admin-configuration-link", label: "nav.adminConfiguration", visible: isAdmin },
  { to: "/admin/facility", testId: "admin-facility-link", label: "nav.adminFacility", visible: isAdmin },
  { to: "/admin/roster", testId: "admin-roster-link", label: "nav.adminRoster", visible: isAdmin },
  { to: "/admin/audit", testId: "admin-audit-link", label: "nav.adminAudit", visible: isAdmin }
];

// NavLink decides aria-current itself, and its to="/" matches every path, so the court plan would
// read as the current page everywhere. The rule below is the one a reader needs.
function isCurrent(destination: Destination, pathname: string): boolean {
  if (destination.to === "/") return pathname === "/" || pathname === "/courts";
  return pathname === destination.to || pathname.startsWith(`${destination.to}/`);
}

export function PrimaryNavigation({ session, signedOut }: { session: SessionStatus; signedOut: () => void }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
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

  return <div data-testid="primary-navigation" className="grid w-full max-w-7xl gap-3">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <nav aria-label={t("nav.primary")} className="flex flex-wrap items-center gap-4">
        {destinations.filter((destination) => destination.visible(session)).map((destination) =>
          <Link
            key={destination.testId}
            to={destination.to}
            data-testid={destination.testId}
            aria-current={isCurrent(destination, pathname) ? "page" : undefined}
            className="font-semibold underline-offset-4"
          >{t(destination.label)}</Link>)}
      </nav>
      {session.authenticated && <Button type="button" data-testid="logout" onClick={() => void logout()}>{t("auth.logout")}</Button>}
      {!session.authenticated && pathname !== "/login" && <Link to="/login" data-testid="sign-in-link" className="rounded-lg bg-(--club-primary) px-4 py-3 font-semibold text-(--club-primary-text)">{t("auth.submit")}</Link>}
    </div>
    {error && <Alert>{error}</Alert>}
  </div>;
}
