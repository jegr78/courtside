import { Navigate, Route, Routes } from "react-router-dom";
import type { ClubConfig } from "../api/client";
import { AdminShell } from "../components/AdminShell";
import { AdminAuditView } from "./AdminAuditView";
import { AdminConfigurationView } from "./AdminConfigurationView";
import { AdminExportView } from "./AdminExportView";
import { AdminStatisticsView } from "./AdminStatisticsView";
import { AdminImportView } from "./AdminImportView";
import { AdminMembershipTypesView } from "./AdminMembershipTypesView";
import { AdminMessagesView } from "./AdminMessagesView";
import { AdminOperationalLogsView } from "./AdminOperationalLogsView";
import { AdminOverviewView } from "./AdminOverviewView";
import { AdminPersonView } from "./AdminPersonView";
import { AdminRosterView } from "./AdminRosterView";
import { AdminSetupView } from "./AdminSetupView";
import { AdminManagedAppointmentsView } from "./AdminManagedAppointmentsView";
import { AdminDeadlinesView } from "./configuration/AdminDeadlinesView";
import { AdminRuleSetsView } from "./configuration/AdminRuleSetsView";
import { AdminBookingCardView } from "./facility/AdminBookingCardView";
import { AdminBookingCardsView } from "./facility/AdminBookingCardsView";
import { AdminCourtsView } from "./facility/AdminCourtsView";
import { AdminOpeningHoursView } from "./facility/AdminOpeningHoursView";
import { AdminSlotFillersView } from "./facility/AdminSlotFillersView";

export default function AdminRoutes({ configurationChanged, administrator }: {
  configurationChanged: (config: ClubConfig) => void;
  administrator: boolean;
}) {
  return <Routes>
    <Route element={<AdminShell administrator={administrator} />}>
      <Route index element={administrator ? <AdminOverviewView /> : <Navigate to="/admin/appointments" replace />} />
      <Route path="appointments" element={<AdminManagedAppointmentsView />} />
      {administrator && <>
      <Route path="setup" element={<AdminSetupView />} />
      <Route path="configuration" element={<AdminConfigurationView configurationChanged={configurationChanged} />} />
      <Route path="deadlines" element={<AdminDeadlinesView configurationChanged={configurationChanged} />} />
      <Route path="rule-sets" element={<AdminRuleSetsView configurationChanged={configurationChanged} />} />
      <Route path="facility">
        <Route index element={<Navigate to="/admin/facility/courts" replace />} />
        <Route path="courts" element={<AdminCourtsView />} />
        <Route path="opening-hours" element={<AdminOpeningHoursView />} />
        <Route path="booking-cards" element={<AdminBookingCardsView />} />
        <Route path="booking-cards/:cardId" element={<AdminBookingCardView />} />
        <Route path="slot-fillers" element={<AdminSlotFillersView />} />
      </Route>
      <Route path="roster" element={<AdminRosterView />} />
      <Route path="roster/:personId" element={<AdminPersonView />} />
      <Route path="membership-types" element={<AdminMembershipTypesView />} />
      <Route path="import" element={<AdminImportView />} />
      <Route path="export" element={<AdminExportView />} />
      <Route path="utilisation" element={<AdminStatisticsView />} />
      <Route path="audit" element={<AdminAuditView />} />
      <Route path="messages" element={<AdminMessagesView />} />
      <Route path="operational-logs" element={<AdminOperationalLogsView />} />
      </>}
      <Route path="*" element={<Navigate to={administrator ? "/" : "/admin/appointments"} replace />} />
    </Route>
  </Routes>;
}
