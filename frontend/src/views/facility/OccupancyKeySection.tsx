import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type IssuedOccupancyKey, type OccupancyKeyStatus } from "../../api/client";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import { formatDateTime } from "../../time/clubZone";

const CREATE = "occupancy-key:create";
const REVOKE = "occupancy-key:revoke";

export function OccupancyKeySection({ timeZone, pending, save, reportError }: {
  timeZone: string;
  pending: ReadonlySet<string>;
  save: (key: string, work: () => Promise<void>) => Promise<void>;
  reportError: (failure: unknown) => void;
}) {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<OccupancyKeyStatus>();
  const [issued, setIssued] = useState<IssuedOccupancyKey>();

  useEffect(() => {
    void api.occupancyKeyStatus().then(setStatus).catch(reportError);
  }, [reportError]);

  function create() {
    return save(CREATE, async () => {
      const created = await api.createOccupancyKey();
      setIssued(created);
      setStatus({ configured: true, createdAt: created.createdAt });
    });
  }

  function revoke() {
    return save(REVOKE, async () => {
      await api.revokeOccupancyKey();
      setIssued(undefined);
      setStatus({ configured: false });
    });
  }

  if (!status) return null;
  const busy = pending.has(CREATE) || pending.has(REVOKE);
  return <section className="grid gap-3" aria-labelledby="building-automation" data-testid="building-automation">
    <h2 id="building-automation" className="text-2xl font-bold">{t("admin.facility.buildingAutomation")}</h2>
    <p className="text-muted">{t("admin.facility.buildingAutomationHint")}</p>
    <p data-testid="occupancy-key-status">
      {status.configured && status.createdAt
        ? t("admin.facility.occupancyKeySince", { since: formatDateTime(status.createdAt, i18n.language, timeZone) })
        : t("admin.facility.occupancyKeyNone")}
    </p>
    {issued && <div className="grid gap-3 rounded-xl border p-4" role="status">
      <p className="font-medium">{t("admin.facility.occupancyKeyShownOnce")}</p>
      <TextField data-testid="occupancy-key-value" readOnly className="font-mono" label={t("admin.facility.occupancyKeyValue")} value={issued.key} />
      <TextField data-testid="occupancy-key-url" readOnly className="font-mono" label={t("admin.facility.occupancyKeyUrl")}
                 value={`${window.location.origin}/api/public/occupancy?key=${issued.key}`} />
    </div>}
    <span className="flex flex-wrap items-center gap-3">
      <Button variant="primary" type="button" data-testid="create-occupancy-key" disabled={busy} onClick={() => void create()}>
        {t(status.configured ? "admin.facility.occupancyKeyRotate" : "admin.facility.occupancyKeyCreate")}
      </Button>
      {status.configured && <Button variant="destructive" type="button" data-testid="revoke-occupancy-key" disabled={busy} onClick={() => void revoke()}>
        {t("admin.facility.occupancyKeyRevoke")}
      </Button>}
    </span>
  </section>;
}
