import { Navigate, Route, Routes } from "react-router-dom";
import type { ClubConfig } from "../api/client";
import { AdminShell } from "../components/AdminShell";
import { AdminAccessGrantsView } from "./AdminAccessGrantsView";
import { AdminAuditView } from "./AdminAuditView";
import { AdminConfigurationView } from "./AdminConfigurationView";
import { AdminExportView } from "./AdminExportView";
import { AdminStatisticsView } from "./AdminStatisticsView";
import { AdminUsageView } from "./AdminUsageView";
import { AdminRetentionView } from "./AdminRetentionView";
import { AdminImportView } from "./AdminImportView";
import { AdminMembershipTypesView } from "./AdminMembershipTypesView";
import { AdminMessagesView } from "./AdminMessagesView";
import { AdminMessageWordingView } from "./AdminMessageWordingView";
import { AdminOperationalLogsView } from "./AdminOperationalLogsView";
import { AdminOperatorHealthView } from "./AdminOperatorHealthView";
import { AdminOverviewView } from "./AdminOverviewView";
import { AdminPersonView } from "./AdminPersonView";
import { AdminRosterView } from "./AdminRosterView";
import { AdminSetupView } from "./AdminSetupView";
import { AdminManagedAppointmentsView } from "./AdminManagedAppointmentsView";
import { AdminDeadlinesView } from "./configuration/AdminDeadlinesView";
import { AdminRuleSetsView } from "./configuration/AdminRuleSetsView";
import { AdminBookingCardView } from "./facility/AdminBookingCardView";
import { AdminBookingCardsView } from "./facility/AdminBookingCardsView";
import { AdminAccessPointsView } from "./facility/AdminAccessPointsView";
import { AdminCourtsView } from "./facility/AdminCourtsView";
import { AdminAvailabilityView } from "./facility/AdminAvailabilityView";
import { AdminOpeningHoursView } from "./facility/AdminOpeningHoursView";
import { AdminSlotFillersView } from "./facility/AdminSlotFillersView";

export default function AdminRoutes({ configurationChanged, administrator, managesAppointments, createsSeries }: {
  configurationChanged: (config: ClubConfig) => void;
  administrator: boolean;
  managesAppointments: boolean;
  createsSeries: boolean;
}) {
  return <Routes>
    <Route element={<AdminShell administrator={administrator} />}>
      <Route index element={administrator ? <AdminOverviewView /> : <Navigate to="/admin/appointments" replace />} />
      <Route path="appointments" element={<AdminManagedAppointmentsView managesAppointments={managesAppointments}
        createsSeries={createsSeries} administrator={administrator} />} />
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
      <Route path="*" element={<Navigate to={administrator ? "/" : "/admin/appointments"} replace />} />
    </Route>
  </Routes>;
}
