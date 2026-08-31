import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

const laidOpenFrom = window.matchMedia("(width >= 1024px)");

function subscribe(changed: () => void) {
  laidOpenFrom.addEventListener("change", changed);
  return () => laidOpenFrom.removeEventListener("change", changed);
}

interface Destination {
  to: string;
  testId: string;
  label: string;
}

interface Group {
  testId: string;
  heading: string;
  destinations: Destination[];
}

const groups: Group[] = [
  {
    testId: "admin-group-club",
    heading: "nav.adminClub",
    destinations: [
      { to: "/admin/configuration", testId: "admin-configuration-link", label: "nav.adminConfiguration" }
    ]
  },
  {
    testId: "admin-group-facility",
    heading: "nav.adminFacility",
    destinations: [
      { to: "/admin/facility/courts", testId: "admin-courts-link", label: "nav.adminCourts" },
      { to: "/admin/facility/opening-hours", testId: "admin-opening-hours-link", label: "nav.adminOpeningHours" },
      { to: "/admin/facility/booking-cards", testId: "admin-booking-cards-link", label: "nav.adminBookingCards" },
      { to: "/admin/facility/slot-fillers", testId: "admin-slot-fillers-link", label: "nav.adminSlotFillers" }
    ]
  },
  {
    testId: "admin-group-people",
    heading: "nav.adminPeople",
    destinations: [
      { to: "/admin/roster", testId: "admin-roster-link", label: "nav.adminRoster" },
      { to: "/admin/membership-types", testId: "admin-membership-types-link", label: "nav.adminMembershipTypes" },
      { to: "/admin/import", testId: "admin-import-link", label: "nav.adminImport" }
    ]
  },
  {
    testId: "admin-group-records",
    heading: "nav.adminRecords",
    destinations: [
      { to: "/admin/audit", testId: "admin-audit-link", label: "nav.adminAudit" },
      { to: "/admin/messages", testId: "admin-messages-link", label: "nav.adminMessages" }
    ]
  }
];

// A person is opened from the roster and stays part of it, so the roster stays where a board is.
function isCurrent(destination: Destination, pathname: string): boolean {
  return pathname === destination.to || pathname.startsWith(`${destination.to}/`);
}

function currentLabel(pathname: string): string | undefined {
  return groups
    .flatMap((group) => group.destinations)
    .find((destination) => isCurrent(destination, pathname))
    ?.label;
}

export function AdminNavigation() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const current = currentLabel(pathname);
  const laidOpen = useSyncExternalStore(subscribe, () => laidOpenFrom.matches, () => false);
  const [unfolded, setUnfolded] = useState(false);

  // A stylesheet cannot lay the panel open: a browser hides a closed disclosure's content whatever
  // the display of that content says, so above the breakpoint the element's own state opens it.
  return <details
    data-testid="admin-navigation"
    open={laidOpen || unfolded}
    onToggle={(event) => { if (!laidOpen) setUnfolded(event.currentTarget.open); }}
  >
    <summary data-testid="admin-menu" className="admin-navigation-menu form-control cursor-pointer list-none rounded-lg border px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
      {current ? t(current) : t("nav.administration")}
    </summary>
    <nav aria-label={t("nav.administration")} className="grid gap-5 pt-3 lg:pt-0">
      <Link data-testid="court-plan-link" to="/" className="font-semibold underline-offset-4">
        {t("nav.courts")}
      </Link>
      {groups.map((group) => <div key={group.testId} data-testid={group.testId} role="group" aria-labelledby={`${group.testId}-heading`} className="grid gap-2">
        <p id={`${group.testId}-heading`} className="text-muted text-xs font-bold tracking-wide uppercase">{t(group.heading)}</p>
        {group.destinations.map((destination) => <Link
          key={destination.testId}
          to={destination.to}
          data-testid={destination.testId}
          aria-current={isCurrent(destination, pathname) ? "page" : undefined}
          className="rounded-lg px-3 py-2 font-semibold aria-[current]:bg-(--cs-raised)"
        >{t(destination.label)}</Link>)}
      </div>)}
    </nav>
  </details>;
}
