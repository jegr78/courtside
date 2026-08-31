import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type DayOfWeek, type OpeningHours } from "../../api/client";
import { Button } from "../../components/Button";
import { ImpactPanel } from "../../components/ImpactPanel";
import { TextField } from "../../components/TextField";
import { shortTime } from "../../time/clubZone";
import { differs } from "../../unsaved/differs";
import { describedByMark } from "../../unsaved/markId";
import { UnsavedMark } from "../../unsaved/UnsavedMark";
import { FacilityPage } from "./FacilityPage";
import { useSaving } from "./useSaving";

export function AdminOpeningHoursView() {
  const { t } = useTranslation();
  const [hours, setHours] = useState<OpeningHours[]>();
  const [confirmed, setConfirmed] = useState<Record<string, OpeningHours>>({});
  const [timeZone, setTimeZone] = useState<string>();
  const { error, success, pending, reportError, save } = useSaving();

  useEffect(() => {
    void Promise.all([api.adminOpeningHours(), api.config()])
      .then(([loaded, configuration]) => {
        setHours(loaded);
        setTimeZone(configuration.timeZone);
        setConfirmed(Object.fromEntries(loaded.map((day) => [String(day.dayOfWeek), day])));
      })
      .catch(reportError);
  }, [reportError]);

  function replace(changed: OpeningHours) {
    setHours((current) => current?.map((item) => item.dayOfWeek === changed.dayOfWeek ? changed : item));
  }

  function confirm(changed: OpeningHours) {
    replace(changed);
    setConfirmed((current) => ({ ...current, [String(changed.dayOfWeek)]: changed }));
  }

  function saveDay(day: OpeningHours) {
    if (!day.opensAt || !day.closesAt) return Promise.resolve();
    return save(`hours:${day.dayOfWeek}`, async () =>
      confirm(await api.setAdminOpeningHours(day.dayOfWeek, {
        opensAt: shortTime(day.opensAt), closesAt: shortTime(day.closesAt)
      })));
  }

  function closeDay(day: DayOfWeek) {
    return save(`hours:${day}`, async () => {
      await api.closeAdminDay(day);
      confirm({ dayOfWeek: day, opensAt: null, closesAt: null });
    });
  }

  return <FacilityPage testId="admin-opening-hours-view" title={t("admin.facility.openingHours")} error={error} success={success}>
    {hours !== undefined && timeZone !== undefined && <div className="grid gap-3 lg:grid-cols-2">
      {hours.map((day) => <HoursEditor
        key={day.dayOfWeek}
        hours={day}
        confirmed={confirmed[String(day.dayOfWeek)]}
        timeZone={timeZone}
        disabled={pending.has(`hours:${day.dayOfWeek}`)}
        changed={replace}
        save={saveDay}
        close={closeDay}
        reportError={reportError}
      />)}
    </div>}
  </FacilityPage>;
}

function HoursEditor({ hours, confirmed, timeZone, disabled, changed, save, close, reportError }: { hours: OpeningHours; confirmed?: OpeningHours; timeZone: string; disabled: boolean; changed: (hours: OpeningHours) => void; save: (hours: OpeningHours) => Promise<void>; close: (day: DayOfWeek) => Promise<void>; reportError: (failure: unknown) => void }) {
  const { t } = useTranslation();
  const mark = `hours:${hours.dayOfWeek}`;
  const unsaved = differs(hours, confirmed);
  return <article className="surface-subtle grid gap-3 rounded-xl border p-4">
    <h2 className="font-bold">{t(`weekday.${hours.dayOfWeek}`)}</h2>
    <div className="grid grid-cols-2 gap-3">
      <TextField disabled={disabled} data-testid={`hours-open-${hours.dayOfWeek}`} type="time" label={t("admin.facility.opensAt")} value={shortTime(hours.opensAt)} onChange={(event) => changed({ ...hours, opensAt: event.target.value })} />
      <TextField disabled={disabled} type="time" label={t("admin.facility.closesAt")} value={shortTime(hours.closesAt)} onChange={(event) => changed({ ...hours, closesAt: event.target.value })} />
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" data-testid={`save-hours-${hours.dayOfWeek}`} aria-describedby={describedByMark(mark, unsaved)} disabled={disabled || !hours.opensAt || !hours.closesAt} type="button" onClick={() => void save(hours)}>{t("admin.save")}</Button>
      <Button variant="destructive" disabled={disabled} type="button" onClick={() => void close(hours.dayOfWeek)}>{t("admin.facility.closeDay")}</Button>
      <UnsavedMark id={mark} unsaved={unsaved} />
    </div>
    <ImpactPanel
      kind="opening-hours"
      subject={hours.dayOfWeek}
      timeZone={timeZone}
      ask={() => api.openingHoursImpact(hours.dayOfWeek, shortTime(hours.opensAt), shortTime(hours.closesAt))}
      reportError={reportError}
    />
  </article>;
}
