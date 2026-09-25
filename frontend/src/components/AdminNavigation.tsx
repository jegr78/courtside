import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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

const overview: Destination = { to: "/admin", testId: "admin-overview-link", label: "nav.adminOverview" };

const groups: Group[] = [
  {
    testId: "admin-group-club",
    heading: "nav.adminClub",
    destinations: [
      { to: "/admin/setup", testId: "admin-setup-link", label: "nav.adminSetup" },
      { to: "/admin/configuration", testId: "admin-configuration-link", label: "nav.adminConfiguration" },
      { to: "/admin/deadlines", testId: "admin-deadlines-link", label: "nav.adminDeadlines" },
      { to: "/admin/rule-sets", testId: "admin-rule-sets-link", label: "nav.adminRuleSets" }
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
      { to: "/admin/utilisation", testId: "admin-utilisation-link", label: "nav.adminUtilisation" },
      { to: "/admin/export", testId: "admin-export-link", label: "nav.adminExport" },
      { to: "/admin/audit", testId: "admin-audit-link", label: "nav.adminAudit" },
      { to: "/admin/messages", testId: "admin-messages-link", label: "nav.adminMessages" },
      { to: "/admin/operational-logs", testId: "admin-operational-logs-link", label: "nav.adminOperationalLogs" }
    ]
  }
];

// A person is opened from the roster and stays part of it, so the roster stays where a board is.
function isCurrent(destination: Destination, pathname: string): boolean {
  if (destination === overview) return pathname.replace(/\/$/, "") === overview.to;
  return pathname === destination.to || pathname.startsWith(`${destination.to}/`);
}

function currentLabel(pathname: string): string | undefined {
  return [overview, ...groups.flatMap((group) => group.destinations)]
    .find((destination) => isCurrent(destination, pathname))
    ?.label;
}

export function AdminNavigation() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const current = currentLabel(pathname);
  const laidOpen = useSyncExternalStore(subscribe, () => laidOpenFrom.matches, () => false);
  const [unfolded, setUnfolded] = useState(false);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const folding = unfolded && !laidOpen;

  const [wasLaidOpen, setWasLaidOpen] = useState(laidOpen);
  if (wasLaidOpen !== laidOpen) {
    setWasLaidOpen(laidOpen);
    if (laidOpen) setUnfolded(false);
  }

  useEffect(() => {
    if (!folding) return;
    const escaped = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setUnfolded(false);
      disclosure.current?.querySelector("summary")?.focus();
    };
    const pressedOutside = (event: PointerEvent) => {
      if (!disclosure.current?.contains(event.target as Node)) setUnfolded(false);
    };
    document.addEventListener("keydown", escaped);
    document.addEventListener("pointerdown", pressedOutside);
    return () => {
      document.removeEventListener("keydown", escaped);
      document.removeEventListener("pointerdown", pressedOutside);
    };
  }, [folding]);

  // A stylesheet cannot lay the panel open: a browser hides a closed disclosure's content whatever
  // the display of that content says, so above the breakpoint the element's own state opens it.
  return <details
    ref={disclosure}
    data-testid="admin-navigation"
    className="group relative"
    open={laidOpen || unfolded}
    onToggle={(event) => { if (!laidOpen) setUnfolded(event.currentTarget.open); }}
    onBlur={(event) => { if (folding && !event.currentTarget.contains(event.relatedTarget)) setUnfolded(false); }}
  >
    <summary data-testid="admin-menu" className="admin-navigation-menu surface-raised focus-ring flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg border px-4 py-3 [&::-webkit-details-marker]:hidden">
      <span className="min-w-0 truncate">
        <span className={current ? "text-muted font-medium" : "font-semibold"}>{t("nav.administration")}</span>
        {current && <>
          {" "}<span aria-hidden="true" className="text-muted px-1">›</span>{" "}
          <span className="font-semibold">{t(current)}</span>
        </>}
      </span>
      <span data-testid="admin-menu-indicator" aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180">▾</span>
    </summary>
    <nav aria-label={t("nav.administration")} className="surface-panel absolute inset-x-0 top-full z-20 mt-2 grid max-h-[70vh] gap-5 overflow-y-auto rounded-xl border p-4 shadow-xl lg:static lg:mt-0 lg:max-h-none lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
      <Link data-testid="court-plan-link" to="/" className="focus-ring rounded-lg font-semibold underline-offset-4">
        {t("nav.courts")}
      </Link>
      <NavigationLink destination={overview} pathname={pathname} chosen={() => { if (!laidOpen) setUnfolded(false); }} />
      {groups.map((group) => <div key={group.testId} data-testid={group.testId} role="group" aria-labelledby={`${group.testId}-heading`} className="grid gap-2 lg:gap-1">
        <p id={`${group.testId}-heading`} className="text-muted text-xs font-bold tracking-wide uppercase">{t(group.heading)}</p>
        {group.destinations.map((destination) => <NavigationLink key={destination.testId} destination={destination}
          pathname={pathname} chosen={() => { if (!laidOpen) setUnfolded(false); }} />)}
      </div>)}
    </nav>
  </details>;
}

function NavigationLink({ destination, pathname, chosen }: { destination: Destination; pathname: string; chosen: () => void }) {
  const { t } = useTranslation();
  return <Link
    to={destination.to}
    data-testid={destination.testId}
    aria-current={isCurrent(destination, pathname) ? "page" : undefined}
    onClick={chosen}
    className="focus-ring rounded-lg px-3 py-2 font-semibold lg:py-1 aria-[current]:bg-(--cs-raised)"
  >{t(destination.label)}</Link>;
}
