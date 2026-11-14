import type { ComponentType } from "react";
import { matchPath } from "react-router-dom";

type PageModule<P> = Promise<{ default: ComponentType<P> }>;

function page<P extends object>(load: () => Promise<ComponentType<P>>): () => PageModule<P> {
  return () => load().then((component) => ({ default: component }));
}

export const adminPages = {
  "/admin": page(() => import("./AdminOverviewView").then((module) => module.AdminOverviewView)),
  "/admin/appointments": page(() => import("./AdminManagedAppointmentsView").then((module) => module.AdminManagedAppointmentsView)),
  "/admin/door-codes": page(() => import("./AdminDoorCodesView").then((module) => module.AdminDoorCodesView)),
  "/admin/guest-fees": page(() => import("./AdminGuestFeesView").then((module) => module.AdminGuestFeesView)),
  "/admin/credit": page(() => import("./AdminCreditView").then((module) => module.AdminCreditView)),
  "/admin/paypal": page(() => import("./AdminPayPalView").then((module) => module.AdminPayPalView)),
  "/admin/setup": page(() => import("./AdminSetupView").then((module) => module.AdminSetupView)),
  "/admin/configuration": page(() => import("./AdminConfigurationView").then((module) => module.AdminConfigurationView)),
  "/admin/deadlines": page(() => import("./configuration/AdminDeadlinesView").then((module) => module.AdminDeadlinesView)),
  "/admin/rule-sets": page(() => import("./configuration/AdminRuleSetsView").then((module) => module.AdminRuleSetsView)),
  "/admin/message-wording": page(() => import("./AdminMessageWordingView").then((module) => module.AdminMessageWordingView)),
  "/admin/facility/courts": page(() => import("./facility/AdminCourtsView").then((module) => module.AdminCourtsView)),
  "/admin/facility/access-points": page(() => import("./facility/AdminAccessPointsView").then((module) => module.AdminAccessPointsView)),
  "/admin/facility/opening-hours": page(() => import("./facility/AdminOpeningHoursView").then((module) => module.AdminOpeningHoursView)),
  "/admin/facility/opening-hours/exceptions": page(() => import("./facility/AdminAvailabilityView").then((module) => module.AdminAvailabilityView)),
  "/admin/facility/booking-cards": page(() => import("./facility/AdminBookingCardsView").then((module) => module.AdminBookingCardsView)),
  "/admin/facility/booking-cards/:cardId": page(() => import("./facility/AdminBookingCardView").then((module) => module.AdminBookingCardView)),
  "/admin/facility/slot-fillers": page(() => import("./facility/AdminSlotFillersView").then((module) => module.AdminSlotFillersView)),
  "/admin/roster": page(() => import("./AdminRosterView").then((module) => module.AdminRosterView)),
  "/admin/roster/:personId": page(() => import("./AdminPersonView").then((module) => module.AdminPersonView)),
  "/admin/membership-types": page(() => import("./AdminMembershipTypesView").then((module) => module.AdminMembershipTypesView)),
  "/admin/import": page(() => import("./AdminImportView").then((module) => module.AdminImportView)),
  "/admin/export": page(() => import("./AdminExportView").then((module) => module.AdminExportView)),
  "/admin/retention": page(() => import("./AdminRetentionView").then((module) => module.AdminRetentionView)),
  "/admin/utilisation": page(() => import("./AdminStatisticsView").then((module) => module.AdminStatisticsView)),
  "/admin/usage": page(() => import("./AdminUsageView").then((module) => module.AdminUsageView)),
  "/admin/audit": page(() => import("./AdminAuditView").then((module) => module.AdminAuditView)),
  "/admin/messages": page(() => import("./AdminMessagesView").then((module) => module.AdminMessagesView)),
  "/admin/operational-logs": page(() => import("./AdminOperationalLogsView").then((module) => module.AdminOperationalLogsView)),
  "/admin/access-grants": page(() => import("./AdminAccessGrantsView").then((module) => module.AdminAccessGrantsView)),
  "/admin/operator-health": page(() => import("./AdminOperatorHealthView").then((module) => module.AdminOperatorHealthView))
};

export function adminPageLoader(pathname: string): (() => PageModule<never>) | undefined {
  const pattern = Object.keys(adminPages).find((path) => matchPath(path, pathname) !== null);
  return pattern === undefined ? undefined : adminPages[pattern as keyof typeof adminPages] as () => PageModule<never>;
}
