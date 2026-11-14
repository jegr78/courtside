import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type DoorCode } from "../api/client";
import { Alert } from "../components/Alert";
import { useReportedFailure } from "../failures/useReportedFailure";

export function AdminDoorCodesView() {
  const { t } = useTranslation();
  const { message: error, report: reportFailure } = useReportedFailure();
  const [doors, setDoors] = useState<DoorCode[]>();

  useEffect(() => {
    let active = true;
    void api.groundsDoorCodes().then((read) => {
      if (active) setDoors(read);
    }).catch(reportFailure);
    return () => {
      active = false;
    };
  }, [reportFailure]);

  return <section data-testid="admin-door-codes-view" className="surface-panel grid min-w-0 gap-8 rounded-2xl border p-4 shadow-[0_20px_50px_var(--cs-shadow)] [&>*]:max-w-5xl sm:p-8">
    <div className="grid gap-3">
      <h1 className="text-3xl font-bold">{t("admin.doorCodes.title")}</h1>
      <p className="text-muted">{t("admin.doorCodes.explain")}</p>
    </div>
    {error && <Alert testId="door-codes-error">{error}</Alert>}
    {doors && (doors.length === 0
      ? <p data-testid="door-codes-empty">{t("admin.doorCodes.empty")}</p>
      : <div className="min-w-0 overflow-x-auto">
        <table data-testid="door-codes-table" className="w-full text-left">
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-2 pr-4">{t("admin.doorCodes.door")}</th>
              <th scope="col" className="py-2 pr-4">{t("admin.doorCodes.staticCode")}</th>
              <th scope="col" className="py-2">{t("admin.doorCodes.emergencyCode")}</th>
            </tr>
          </thead>
          <tbody>
            {doors.map((door) => <tr key={door.accessPointId} data-testid="door-codes-row" className="border-b">
              <th scope="row" className="py-2 pr-4 font-medium">{door.accessPointName}</th>
              <td data-testid="door-codes-static" className="py-2 pr-4 font-mono text-lg">
                {door.staticCode ?? <span className="text-muted font-sans text-base">{t("admin.doorCodes.none")}</span>}
              </td>
              <td data-testid="door-codes-emergency" className="py-2 font-mono text-lg">
                {door.emergencyCode ?? <span className="text-muted font-sans text-base">{t("admin.doorCodes.none")}</span>}
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>)}
  </section>;
}
