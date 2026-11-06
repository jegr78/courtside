import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Alert } from "../components/Alert";
import { useReportedFailure } from "../failures/useReportedFailure";
import { BookingsExport } from "./BookingsExport";
import { LogExport } from "./LogExport";
import { RosterExport } from "./RosterExport";

export function AdminExportView() {
  const { t } = useTranslation();
  const { message: error, report: reportError } = useReportedFailure();

  return <section data-testid="admin-export-view" className="surface-panel grid gap-8 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] [&>*]:max-w-5xl sm:p-8">
    <h1 className="text-3xl font-bold">{t("admin.export.title")}</h1>
    <p className="text-muted">{t("admin.export.explain")}</p>
    {error && <Alert>{error}</Alert>}
    <RosterExport disabled={false} onFailure={reportError} />
    <BookingsExport onFailure={reportError} />
    <section data-testid="guest-fees-export" className="grid gap-3 rounded-xl border p-4">
      <h2 className="text-2xl font-bold">{t("admin.export.guestFees")}</h2>
      <p className="text-muted text-sm">{t("admin.export.guestFeesExplain")}</p>
      <Link data-testid="guest-fees-open" to="/admin/guest-fees" className="focus-ring justify-self-start rounded-lg font-semibold underline underline-offset-4">
        {t("admin.export.guestFeesOpen")}
      </Link>
    </section>
    <LogExport log="audit" onFailure={reportError} />
    <LogExport log="messages" onFailure={reportError} />
  </section>;
}
