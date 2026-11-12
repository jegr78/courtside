import { Navigate, Route, Routes } from "react-router-dom";
import type { ClubConfig } from "../api/client";
import { AdminShell } from "../components/AdminShell";
import { lazySurface } from "../navigation/lazySurface";
import { adminPages } from "./adminPages";

const AdminOverviewView = lazySurface(adminPages["/admin"]);
const AdminManagedAppointmentsView = lazySurface(adminPages["/admin/appointments"]);
const AdminGuestFeesView = lazySurface(adminPages["/admin/guest-fees"]);
const AdminCreditView = lazySurface(adminPages["/admin/credit"]);
const AdminPayPalView = lazySurface(adminPages["/admin/paypal"]);
const AdminSetupView = lazySurface(adminPages["/admin/setup"]);
const AdminConfigurationView = lazySurface(adminPages["/admin/configuration"]);
const AdminDeadlinesView = lazySurface(adminPages["/admin/deadlines"]);
const AdminRuleSetsView = lazySurface(adminPages["/admin/rule-sets"]);
const AdminMessageWordingView = lazySurface(adminPages["/admin/message-wording"]);
const AdminCourtsView = lazySurface(adminPages["/admin/facility/courts"]);
const AdminAccessPointsView = lazySurface(adminPages["/admin/facility/access-points"]);
const AdminOpeningHoursView = lazySurface(adminPages["/admin/facility/opening-hours"]);
const AdminAvailabilityView = lazySurface(adminPages["/admin/facility/opening-hours/exceptions"]);
const AdminBookingCardsView = lazySurface(adminPages["/admin/facility/booking-cards"]);
const AdminBookingCardView = lazySurface(adminPages["/admin/facility/booking-cards/:cardId"]);
const AdminSlotFillersView = lazySurface(adminPages["/admin/facility/slot-fillers"]);
const AdminRosterView = lazySurface(adminPages["/admin/roster"]);
const AdminPersonView = lazySurface(adminPages["/admin/roster/:personId"]);
const AdminMembershipTypesView = lazySurface(adminPages["/admin/membership-types"]);
const AdminImportView = lazySurface(adminPages["/admin/import"]);
const AdminExportView = lazySurface(adminPages["/admin/export"]);
const AdminRetentionView = lazySurface(adminPages["/admin/retention"]);
const AdminStatisticsView = lazySurface(adminPages["/admin/utilisation"]);
const AdminUsageView = lazySurface(adminPages["/admin/usage"]);
const AdminAuditView = lazySurface(adminPages["/admin/audit"]);
const AdminMessagesView = lazySurface(adminPages["/admin/messages"]);
const AdminOperationalLogsView = lazySurface(adminPages["/admin/operational-logs"]);
const AdminAccessGrantsView = lazySurface(adminPages["/admin/access-grants"]);
const AdminOperatorHealthView = lazySurface(adminPages["/admin/operator-health"]);

export default function AdminRoutes({ configurationChanged, administrator, treasurer = administrator, managesAppointments, createsSeries }: {
  configurationChanged: (config: ClubConfig) => void;
  administrator: boolean;
  treasurer?: boolean;
  managesAppointments: boolean;
  createsSeries: boolean;
}) {
  const appointmentsShown = administrator || managesAppointments || createsSeries;
  const landing = appointmentsShown ? "/admin/appointments" : "/admin/guest-fees";
  return <Routes>
    <Route element={<AdminShell administrator={administrator} treasurer={treasurer} appointmentsShown={appointmentsShown} />}>
      <Route index element={administrator ? <AdminOverviewView /> : <Navigate to={landing} replace />} />
      <Route path="appointments" element={appointmentsShown ? <AdminManagedAppointmentsView managesAppointments={managesAppointments}
        createsSeries={createsSeries} administrator={administrator} /> : <Navigate to={landing} replace />} />
      {treasurer && <Route path="guest-fees" element={<AdminGuestFeesView />} />}
      {treasurer && <Route path="credit" element={<AdminCreditView />} />}
      {treasurer && <Route path="paypal" element={<AdminPayPalView />} />}
      {administrator && <>
      <Route path="setup" element={<AdminSetupView />} />
      <Route path="configuration" element={<AdminConfigurationView configurationChanged={configurationChanged} />} />
      <Route path="deadlines" element={<AdminDeadlinesView configurationChanged={configurationChanged} />} />
      <Route path="rule-sets" element={<AdminRuleSetsView configurationChanged={configurationChanged} />} />
      <Route path="message-wording" element={<AdminMessageWordingView />} />
      <Route path="facility">
        <Route index element={<Navigate to="/admin/facility/courts" replace />} />
        <Route path="courts" element={<AdminCourtsView />} />
        <Route path="access-points" element={<AdminAccessPointsView configurationChanged={configurationChanged} />} />
        <Route path="opening-hours" element={<AdminOpeningHoursView />} />
        <Route path="opening-hours/exceptions" element={<AdminAvailabilityView />} />
        <Route path="booking-cards" element={<AdminBookingCardsView />} />
        <Route path="booking-cards/:cardId" element={<AdminBookingCardView />} />
        <Route path="slot-fillers" element={<AdminSlotFillersView />} />
      </Route>
      <Route path="roster" element={<AdminRosterView />} />
      <Route path="roster/:personId" element={<AdminPersonView />} />
      <Route path="membership-types" element={<AdminMembershipTypesView />} />
      <Route path="import" element={<AdminImportView />} />
      <Route path="export" element={<AdminExportView />} />
      <Route path="retention" element={<AdminRetentionView />} />
      <Route path="utilisation" element={<AdminStatisticsView />} />
      <Route path="usage" element={<AdminUsageView />} />
      <Route path="audit" element={<AdminAuditView />} />
      <Route path="messages" element={<AdminMessagesView />} />
      <Route path="operational-logs" element={<AdminOperationalLogsView />} />
      <Route path="access-grants" element={<AdminAccessGrantsView />} />
      <Route path="operator-health" element={<AdminOperatorHealthView />} />
      </>}
      <Route path="*" element={<Navigate to={administrator ? "/" : landing} replace />} />
    </Route>
  </Routes>;
}
