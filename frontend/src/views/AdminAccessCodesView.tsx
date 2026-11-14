import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type AccessPointCodes } from "../api/client";
import { Alert } from "../components/Alert";
import { useReportedFailure } from "../failures/useReportedFailure";

export function AdminAccessCodesView() {
  const { t } = useTranslation();
  const { message: error, report: reportFailure } = useReportedFailure();
  const [accessPoints, setAccessPoints] = useState<AccessPointCodes[]>();

  useEffect(() => {
    let active = true;
    void api.accessPointCodes().then((read) => {
      if (active) setAccessPoints(read);
    }).catch(reportFailure);
    return () => {
      active = false;
    };
  }, [reportFailure]);

  return <section data-testid="admin-access-codes-view" className="surface-panel grid min-w-0 gap-8 rounded-2xl border p-4 shadow-[0_20px_50px_var(--cs-shadow)] [&>*]:max-w-5xl sm:p-8">
    <div className="grid gap-3">
      <h1 className="text-3xl font-bold">{t("admin.accessCodes.title")}</h1>
      <p className="text-muted">{t("admin.accessCodes.explain")}</p>
    </div>
    {error && <Alert testId="access-codes-error">{error}</Alert>}
    {accessPoints && (accessPoints.length === 0
      ? <p data-testid="access-codes-empty">{t("admin.accessCodes.empty")}</p>
      : <div className="min-w-0 overflow-x-auto">
        <table data-testid="access-codes-table" className="w-full text-left">
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-2 pr-4">{t("admin.accessCodes.accessPoint")}</th>
              <th scope="col" className="py-2 pr-4">{t("admin.accessCodes.staticCode")}</th>
              <th scope="col" className="py-2">{t("admin.accessCodes.emergencyCode")}</th>
            </tr>
          </thead>
          <tbody>
            {accessPoints.map((accessPoint) => <tr key={accessPoint.id} data-testid="access-codes-row" className="border-b">
              <th scope="row" className="py-2 pr-4 font-medium">{accessPoint.name}</th>
              <td data-testid="access-codes-static" className="py-2 pr-4 font-mono tabular-nums">
                {accessPoint.staticCode ?? <span className="text-muted font-sans">{t("admin.accessCodes.none")}</span>}
              </td>
              <td data-testid="access-codes-emergency" className="py-2 font-mono tabular-nums">
                {accessPoint.emergencyCode ?? <span className="text-muted font-sans">{t("admin.accessCodes.none")}</span>}
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>)}
  </section>;
}
