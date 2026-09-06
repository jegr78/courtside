import { useTranslation } from "react-i18next";
import { Alert } from "../components/Alert";
import { useReportedFailure } from "../failures/useReportedFailure";
import { BookingsExport } from "./BookingsExport";
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
  </section>;
}
