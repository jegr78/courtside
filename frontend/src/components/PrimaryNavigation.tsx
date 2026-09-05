import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { type SessionStatus } from "../api/client";

interface Destination {
  to: string;
  testId: string;
  label: string;
  visible: (session: SessionStatus) => boolean;
}

const isAdmin = (session: SessionStatus) => session.roles.includes("ADMIN");

// Administration is one destination here and unfolds into its own navigation once inside: the two
// audiences do not share a layout, and this bar cannot grow with a surface that keeps gaining pages.
const destinations: Destination[] = [
  { to: "/", testId: "court-plan-link", label: "nav.courts", visible: () => true },
  { to: "/my-bookings", testId: "my-bookings-link", label: "nav.myBookings", visible: (session) => session.authenticated },
  { to: "/my-messages", testId: "my-messages-link", label: "nav.myMessages", visible: (session) => session.authenticated },
  { to: "/admin/configuration", testId: "administration-link", label: "nav.administration", visible: isAdmin }
];

// NavLink decides aria-current itself, and its to="/" matches every path, so the court plan would
// read as the current page everywhere. The rule below is the one a reader needs.
function isCurrent(destination: Destination, pathname: string): boolean {
  if (destination.to === "/") return pathname === "/" || pathname === "/courts";
  return pathname === destination.to || pathname.startsWith(`${destination.to}/`);
}

const BAR = "fixed inset-x-0 bottom-0 z-40 flex justify-around border-t px-2 py-2 "
  + "pb-[max(0.5rem,env(safe-area-inset-bottom))] surface-panel "
  + "sm:static sm:justify-start sm:gap-4 sm:border-0 sm:bg-transparent sm:p-0";

export function PrimaryNavigation({ session }: { session: SessionStatus }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const open = destinations.filter((destination) => destination.visible(session));

  // A bar holding the one page you are already on takes a phone's bottom edge for nothing, so a
  // visitor who can reach nowhere else keeps the row the destinations came from.
  const reachable = open.length > 1;

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
            aria-current={isCurrent(destination, pathname) ? "page" : undefined}
            className="flex min-h-11 items-center px-3 font-semibold underline-offset-4 sm:min-h-0 sm:px-0"
          >{t(destination.label)}</Link>)}
      </nav>
      {!session.authenticated && pathname !== "/login" && <Link to="/login" data-testid="sign-in-link" className="button-primary rounded-lg px-4 py-3 font-semibold">{t("auth.submit")}</Link>}
    </div>
  </div>;
}
