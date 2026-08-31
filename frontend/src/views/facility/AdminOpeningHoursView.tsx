import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ApiError, api, type DayOfWeek, type OpeningHours } from "../../api/client";
import { useClubConfiguration } from "../../club/registry";
import { Button } from "../../components/Button";
import { ImpactPanel } from "../../components/ImpactPanel";
import { TextField } from "../../components/TextField";
import { shortTime } from "../../time/clubZone";
import { differs } from "../../unsaved/differs";
import { describedByMark } from "../../unsaved/markId";
import { UnsavedMark } from "../../unsaved/UnsavedMark";
import { FacilityPage } from "./FacilityPage";
import { useSaving } from "./useSaving";

type WeekDay = { dayOfWeek: DayOfWeek; opensAt: string; closesAt: string; closed: boolean };

const MARK = "opening-hours";

export function AdminOpeningHoursView() {
  const { t } = useTranslation();
  const { club, error: clubError } = useClubConfiguration();
  const [week, setWeek] = useState<WeekDay[]>();
  const [confirmed, setConfirmed] = useState<WeekDay[]>();
  const [rejected, setRejected] = useState<Record<string, string>>({});
  const { error, success, pending, reportError, save } = useSaving();

  useEffect(() => {
    void api.adminOpeningHours()
      .then((loaded) => {
        setWeek(loaded.map(toWeekDay));
        setConfirmed(loaded.map(toWeekDay));
      })
      .catch(reportError);
  }, [reportError]);

  function replace(changed: WeekDay) {
    setWeek((current) => current?.map((day) => day.dayOfWeek === changed.dayOfWeek ? changed : day));
  }

  function applyTo(days: Set<DayOfWeek>, opensAt: string, closesAt: string) {
    setWeek((current) => current?.map((day) => days.has(day.dayOfWeek)
      ? { ...day, opensAt, closesAt, closed: false }
      : day));
  }

  function saveWeek(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!week) return Promise.resolve();
    const incomplete = incompleteDays(week, t);
    if (Object.keys(incomplete).length > 0) {
      setRejected(incomplete);
      return Promise.resolve();
    }
    return save(MARK, async () => {
      try {
        const stored = await api.setAdminWeeklyOpeningHours(week.map(toRequest));
        setRejected({});
        setWeek(stored.map(toWeekDay));
        setConfirmed(stored.map(toWeekDay));
      } catch (failure) {
        setRejected(rejectedDays(failure, t));
        throw failure;
      }
    });
  }

  const unsaved = differs({ week }, { week: confirmed });
  const saving = pending.has(MARK);
  return <FacilityPage testId="admin-opening-hours-view" title={t("admin.facility.openingHours")} error={error ?? clubError} success={success}>
    {week !== undefined && club !== undefined && <form noValidate onSubmit={(event) => void saveWeek(event)} className="grid gap-4">
      <ApplyToDays disabled={saving} apply={applyTo} />
      <div className="grid gap-3 lg:grid-cols-2">
        {week.map((day) => <DayEditor
          key={day.dayOfWeek}
          day={day}
          timeZone={club.timeZone}
          disabled={saving}
          rejected={rejected[day.dayOfWeek]}
          changed={replace}
          reportError={reportError}
        />)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" data-testid="save-opening-hours" aria-describedby={describedByMark(MARK, unsaved)} disabled={saving} type="submit">{t("admin.save")}</Button>
        <UnsavedMark id={MARK} unsaved={unsaved} />
      </div>
    </form>}
  </FacilityPage>;
}

function ApplyToDays({ disabled, apply }: { disabled: boolean; apply: (days: Set<DayOfWeek>, opensAt: string, closesAt: string) => void }) {
  const { t } = useTranslation();
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [days, setDays] = useState(new Set<DayOfWeek>());

  function toggle(day: DayOfWeek, picked: boolean) {
    setDays((current) => {
      const next = new Set(current);
      if (picked) next.add(day); else next.delete(day);
      return next;
    });
  }

  return <fieldset className="surface-subtle grid gap-3 rounded-xl border p-4">
    <legend className="font-bold">{t("admin.facility.applyToDays")}</legend>
    <p data-testid="apply-to-days-hint" className="text-sm text-[var(--cs-muted)]">{t("admin.facility.applyToDaysHint")}</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField disabled={disabled} data-testid="apply-opens-at" type="time" label={t("admin.facility.opensAt")} value={opensAt} onChange={(event) => setOpensAt(event.target.value)} />
      <TextField disabled={disabled} data-testid="apply-closes-at" type="time" label={t("admin.facility.closesAt")} value={closesAt} onChange={(event) => setClosesAt(event.target.value)} />
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {weekdays.map((day) => <label key={day} className="flex items-center gap-2 font-medium">
        <input data-testid={`apply-day-${day}`} disabled={disabled} type="checkbox" checked={days.has(day)} onChange={(event) => toggle(day, event.target.checked)} />
        {t(`weekday.${day}`)}
      </label>)}
    </div>
    <Button variant="secondary" data-testid="apply-hours" className="justify-self-start" disabled={disabled || days.size === 0 || !opensAt || !closesAt} type="button" onClick={() => apply(days, opensAt, closesAt)}>{t("admin.facility.apply")}</Button>
  </fieldset>;
}

function DayEditor({ day, timeZone, disabled, rejected, changed, reportError }: { day: WeekDay; timeZone: string; disabled: boolean; rejected?: string; changed: (day: WeekDay) => void; reportError: (failure: unknown) => void }) {
  const { t } = useTranslation();
  const errorId = `hours-error-${day.dayOfWeek}`;
  return <article className="surface-subtle grid gap-3 rounded-xl border p-4">
    <h2 className="font-bold">{t(`weekday.${day.dayOfWeek}`)}</h2>
    <div className="grid grid-cols-2 gap-3">
      <TextField disabled={disabled || day.closed} data-testid={`hours-open-${day.dayOfWeek}`} type="time" aria-describedby={rejected ? errorId : undefined} label={t("admin.facility.opensAt")} value={day.opensAt} onChange={(event) => changed({ ...day, opensAt: event.target.value })} />
      <TextField disabled={disabled || day.closed} data-testid={`hours-close-${day.dayOfWeek}`} type="time" aria-describedby={rejected ? errorId : undefined} label={t("admin.facility.closesAt")} value={day.closesAt} onChange={(event) => changed({ ...day, closesAt: event.target.value })} />
    </div>
    <label className="flex items-center gap-2 font-medium">
      <input data-testid={`hours-closed-${day.dayOfWeek}`} disabled={disabled} type="checkbox" checked={day.closed} onChange={(event) => changed(event.target.checked ? { ...day, opensAt: "", closesAt: "", closed: true } : { ...day, closed: false })} />
      {t("admin.facility.closeDay")}
    </label>
    {rejected && <p id={errorId} data-testid={errorId} className="text-sm text-red-800 dark:text-red-200">{rejected}</p>}
    <ImpactPanel
      kind="opening-hours"
      subject={day.dayOfWeek}
      timeZone={timeZone}
      ask={() => api.openingHoursImpact(day.dayOfWeek, day.opensAt || undefined, day.closesAt || undefined)}
      reportError={reportError}
    />
  </article>;
}

const weekdays: DayOfWeek[] = [
  "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"
];

function toWeekDay(hours: OpeningHours): WeekDay {
  return {
    dayOfWeek: hours.dayOfWeek,
    opensAt: shortTime(hours.opensAt),
    closesAt: shortTime(hours.closesAt),
    closed: !hours.opensAt && !hours.closesAt
  };
}

function toRequest(day: WeekDay): OpeningHours {
  return day.closed
    ? { dayOfWeek: day.dayOfWeek, opensAt: null, closesAt: null }
    : { dayOfWeek: day.dayOfWeek, opensAt: day.opensAt, closesAt: day.closesAt };
}

// A day the wire cannot express: neither a window nor a closure, so the form says so rather than
// sending a body that would silently arrive as one of the two.
function incompleteDays(week: WeekDay[], t: TFunction): Record<string, string> {
  const marked: Record<string, string> = {};
  week.filter((day) => !day.closed && (!day.opensAt || !day.closesAt))
    .forEach((day) => { marked[day.dayOfWeek] = t("openingWindow.incomplete"); });
  return marked;
}

function rejectedDays(failure: unknown, t: TFunction): Record<string, string> {
  if (!(failure instanceof ApiError)) return {};
  const marked: Record<string, string> = {};
  for (const violation of failure.problem?.violations ?? []) {
    const day = violation.params?.day;
    if (typeof day === "string") {
      marked[day] = t(violation.code, { ...violation.params, defaultValue: t("error.generic") });
    }
  }
  return marked;
}
