import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { type SessionStatus } from "../api/client";

interface Destination {
  to: string;
  testId: string;
  label: string;
  compactLabel: string;
  icon: "courts" | "bookings" | "messages" | "administration";
  visible: (session: SessionStatus) => boolean;
}

const isAdmin = (session: SessionStatus) => session.roles.includes("ADMIN");

const destinations: Destination[] = [
  { to: "/", testId: "court-plan-link", label: "nav.courts", compactLabel: "nav.courtsCompact", icon: "courts", visible: () => true },
  { to: "/my-bookings", testId: "my-bookings-link", label: "nav.myBookings", compactLabel: "nav.myBookingsCompact", icon: "bookings", visible: (session) => session.authenticated },
  { to: "/my-messages", testId: "my-messages-link", label: "nav.myMessages", compactLabel: "nav.myMessagesCompact", icon: "messages", visible: (session) => session.authenticated },
  { to: "/admin/setup", testId: "administration-link", label: "nav.administration", compactLabel: "nav.administrationCompact", icon: "administration", visible: isAdmin }
];

function isCurrent(destination: Destination, pathname: string): boolean {
  if (destination.to === "/") return pathname === "/" || pathname === "/courts";
  return pathname === destination.to || pathname.startsWith(`${destination.to}/`);
}

const BAR = "fixed inset-x-0 bottom-0 z-10 flex w-full items-center border-t px-2 py-2 "
  + "pb-[max(0.5rem,env(safe-area-inset-bottom))] surface-panel "
  + "sm:static sm:w-auto sm:flex-wrap sm:justify-start sm:gap-4 sm:border-0 sm:bg-transparent sm:p-0";

function DestinationIcon({ destination }: { destination: Destination }) {
  const path = {
    courts: <><path d="M4 5h16v14H4z" /><path d="M8 3v4M16 3v4M4 9h16" /></>,
    bookings: <><path d="M5 4h14v16H5z" /><path d="M8 2v4M16 2v4M5 8h14M8 13l2 2 4-4" /></>,
    messages: <><path d="M4 5h16v14H4z" /><path d="m4 7 8 6 8-6" /></>,
    administration: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="10" cy="18" r="2" /></>
  }[destination.icon];
  return <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    data-testid={`${destination.testId.replace("-link", "")}-icon`}
    className="size-5 shrink-0 sm:hidden"
  >{path}</svg>;
}

export function PrimaryNavigation({ session }: { session: SessionStatus }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const open = destinations.filter((destination) => destination.visible(session));

  const reachable = open.length > 1;
  const linkClass = reachable
    ? "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-center text-xs font-semibold underline-offset-4 sm:block sm:min-h-0 sm:flex-none sm:px-0 sm:text-base"
    : "flex min-h-11 items-center px-3 font-semibold underline-offset-4 sm:block sm:min-h-0 sm:px-0";

  return <div data-testid="primary-navigation" className="grid w-full max-w-7xl gap-3">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <nav
        aria-label={t("nav.primary")}
        data-testid={reachable ? "primary-navigation-bar" : undefined}
        className={reachable ? BAR : "flex flex-wrap items-center gap-4"}
      >
        {open.map((destination) =>
          <Link
            key={destination.testId}
            to={destination.to}
            data-testid={destination.testId}
            aria-label={t(destination.label)}
            aria-current={isCurrent(destination, pathname) ? "page" : undefined}
            className={linkClass}
          >
            {reachable ? <>
              <DestinationIcon destination={destination} />
              <span data-testid={`${destination.testId.replace("-link", "")}-compact-label`} className="sm:hidden">{t(destination.compactLabel)}</span>
              <span data-testid={`${destination.testId.replace("-link", "")}-full-label`} className="hidden sm:inline">{t(destination.label)}</span>
            </> : t(destination.label)}
          </Link>)}
      </nav>
      {!session.authenticated && pathname !== "/login" && <Link to="/login" data-testid="sign-in-link" className="button-primary rounded-lg px-4 py-3 font-semibold">{t("auth.submit")}</Link>}
    </div>
  </div>;
}
