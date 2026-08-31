import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

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
      { to: "/admin/configuration", testId: "admin-configuration-link", label: "nav.adminConfiguration" },
      { to: "/admin/facility", testId: "admin-facility-link", label: "nav.adminFacility" }
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

  // Folded away below the breakpoint and laid open above it, where the stylesheet shows the panel
  // whatever the element's own state is — the court plan switches between its two shapes the same way.
  return <details className="admin-navigation">
    <summary data-testid="admin-menu" className="admin-navigation-menu form-control cursor-pointer list-none rounded-lg border px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
      {current ? t(current) : t("nav.administration")}
    </summary>
    <nav aria-label={t("nav.administration")} className="admin-navigation-panel grid gap-5 pt-3 lg:pt-0">
      <Link data-testid="court-plan-link" to="/" className="font-semibold underline-offset-4">
        {t("nav.courts")}
      </Link>
      {groups.map((group) => <div key={group.testId} data-testid={group.testId} className="grid gap-2">
        <h2 className="text-muted text-xs font-bold tracking-wide uppercase">{t(group.heading)}</h2>
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
