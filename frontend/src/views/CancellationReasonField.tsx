import { useTranslation } from "react-i18next";
import type { CancellationReason } from "../api/client";

const cancellationReasons: CancellationReason[] = ["COURT_CONDITION", "WEATHER", "CLUB_EVENT", "MAINTENANCE", "OTHER"];

export function CancellationReasonField({ reason, changed }: { reason?: CancellationReason; changed: (reason?: CancellationReason) => void }) {
  const { t } = useTranslation();
  return <label className="grid gap-1 font-semibold">{t("booking.reasonLabel")}
    <select data-testid="cancellation-reason" value={reason ?? ""} onChange={(event) => changed(event.target.value ? event.target.value as CancellationReason : undefined)} className="form-control rounded border px-3 py-2">
      <option value="">{t("booking.reasonNone")}</option>
      {cancellationReasons.map((value) => <option key={value} value={value}>{t(`cancellationReason.${value}`)}</option>)}
    </select>
    <span className="text-muted text-sm font-normal">{t("booking.reasonHint")}</span>
  </label>;
}
