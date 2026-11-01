import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type IssuedOccupancyKey, type OccupancyKeyStatus } from "../../api/client";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import { TextField } from "../../components/TextField";
import { formatDateTime } from "../../time/clubZone";

const CREATE = "occupancy-key:create";
const REVOKE = "occupancy-key:revoke";

type Confirming = "rotate" | "revoke";

export function OccupancyKeySection({ timeZone, pending, save, reportError }: {
  timeZone: string;
  pending: ReadonlySet<string>;
  save: (key: string, work: () => Promise<void>) => Promise<void>;
  reportError: (failure: unknown) => void;
}) {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<OccupancyKeyStatus>();
  const [issued, setIssued] = useState<IssuedOccupancyKey>();
  const [confirming, setConfirming] = useState<Confirming>();

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

  function confirmed() {
    const chosen = confirming;
    setConfirming(undefined);
    void (chosen === "revoke" ? revoke() : create());
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
      <Button variant="primary" type="button" data-testid="create-occupancy-key" disabled={busy}
              onClick={() => status.configured ? setConfirming("rotate") : void create()}>
        {t(status.configured ? "admin.facility.occupancyKeyRotate" : "admin.facility.occupancyKeyCreate")}
      </Button>
      {status.configured && <Button variant="destructive" type="button" data-testid="revoke-occupancy-key" disabled={busy} onClick={() => setConfirming("revoke")}>
        {t("admin.facility.occupancyKeyRevoke")}
      </Button>}
    </span>
    {confirming && <Modal labelledBy="occupancy-key-confirm-title" closed={() => setConfirming(undefined)}>
      <div className="grid gap-4">
        <h2 id="occupancy-key-confirm-title" className="text-2xl font-bold">
          {t(confirming === "revoke" ? "admin.facility.occupancyKeyRevokeTitle" : "admin.facility.occupancyKeyRotateTitle")}
        </h2>
        <p>{t(confirming === "revoke" ? "admin.facility.occupancyKeyRevokeExplain" : "admin.facility.occupancyKeyRotateExplain")}</p>
        <div className="flex flex-wrap gap-3">
          <Button variant="destructive-confirm" data-testid="confirm-occupancy-key" disabled={busy} type="button" onClick={confirmed}>
            {t(confirming === "revoke" ? "admin.facility.occupancyKeyRevoke" : "admin.facility.occupancyKeyRotate")}
          </Button>
          <Button variant="secondary" data-testid="cancel-occupancy-key" type="button" onClick={() => setConfirming(undefined)}>{t("admin.cancel")}</Button>
        </div>
      </div>
    </Modal>}
  </section>;
}
