import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  api, type AdminCourt, type CourtClosure, type DayOfWeek, type OpeningHours, type OpeningPeriod
} from "../../api/client";
import { useClubConfiguration } from "../../club/registry";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import { dateInTimeZoneValue, formatDateRange, shortTime } from "../../time/clubZone";
import { differs } from "../../unsaved/differs";
import { useUnsavedMark } from "../../unsaved/registry";
import { FacilityPage } from "./FacilityPage";
import { useSaving } from "./useSaving";

type Kind = OpeningPeriod["kind"];
type Hours = { dayOfWeek: DayOfWeek; opensAt: string; closesAt: string; closed: boolean };
type PeriodDraft = { id?: string; kind: Kind; name: string; startsOn: string; endsOn: string; days: Hours[] };
type ClosureDraft = { id?: string; courtId: string; name: string; startsOn: string; endsOn: string };

const weekdays: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const MAX_NAME = 80;

const newPeriod = (): PeriodDraft => ({
  kind: "HOLIDAY", name: "", startsOn: "", endsOn: "",
  days: weekdays.map((dayOfWeek) => ({ dayOfWeek, opensAt: "", closesAt: "", closed: true }))
});
const newClosure = (courtId = ""): ClosureDraft => ({ courtId, name: "", startsOn: "", endsOn: "" });

export function AdminAvailabilityView() {
  const { t } = useTranslation();
  const { club, error: clubError } = useClubConfiguration();
  const [periods, setPeriods] = useState<OpeningPeriod[]>();
  const [closures, setClosures] = useState<CourtClosure[]>();
  const [courts, setCourts] = useState<AdminCourt[]>();
  const [period, setPeriod] = useState<PeriodDraft>(newPeriod);
  const [closure, setClosure] = useState<ClosureDraft>(newClosure);
  const { error, success, pending, reportError, refuse, save } = useSaving();
  const today = useMemo(() => dateInTimeZoneValue(new Date(), club?.timeZone), [club?.timeZone]);

  useEffect(() => {
    void Promise.all([api.adminOpeningPeriods(), api.adminCourtClosures(), api.adminCourts()])
      .then(([loadedPeriods, loadedClosures, loadedCourts]) => {
        setPeriods(loadedPeriods);
        setClosures(loadedClosures);
        setCourts(loadedCourts);
      })
      .catch(reportError);
  }, [reportError]);

  const editedPeriod = periods?.find((entry) => entry.id === period.id);
  const editedClosure = closures?.find((entry) => entry.id === closure.id);
  useUnsavedMark("opening-period", differs(period, editedPeriod ? toDraft(editedPeriod) : newPeriod()));
  useUnsavedMark("court-closure", differs(closure, editedClosure ? { ...editedClosure } : newClosure()));

  function savePeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missing = !period.name.trim() || !period.startsOn || !period.endsOn;
    if (missing) return Promise.resolve(refuse(t("admin.availability.incomplete")));
    if (period.days.some((day) => !day.closed && (!day.opensAt || !day.closesAt))) {
      return Promise.resolve(refuse(t("admin.facility.dayNeedsBothTimes")));
    }
    const body = { kind: period.kind, name: period.name, startsOn: period.startsOn, endsOn: period.endsOn, days: toRequest(period) };
    return save("opening-period", async () => {
      if (period.id) await api.changeAdminOpeningPeriod(period.id, body);
      else await api.createAdminOpeningPeriod(body);
      setPeriods(await api.adminOpeningPeriods());
      setPeriod(newPeriod());
    });
  }

  function saveClosure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!closure.courtId || !closure.name.trim() || !closure.startsOn || !closure.endsOn) {
      return Promise.resolve(refuse(t("admin.availability.incomplete")));
    }
    const body = { courtId: closure.courtId, name: closure.name, startsOn: closure.startsOn, endsOn: closure.endsOn };
    return save("court-closure", async () => {
      if (closure.id) await api.changeAdminCourtClosure(closure.id, body);
      else await api.createAdminCourtClosure(body);
      setClosures(await api.adminCourtClosures());
      setClosure(newClosure());
    });
  }

  function removePeriod(entry: OpeningPeriod) {
    void save(`opening-period-${entry.id}`, async () => {
      await api.removeAdminOpeningPeriod(entry.id);
      setPeriods(await api.adminOpeningPeriods());
      if (period.id === entry.id) setPeriod(newPeriod());
    });
  }

  function removeClosure(entry: CourtClosure) {
    void save(`court-closure-${entry.id}`, async () => {
      await api.removeAdminCourtClosure(entry.id);
      setClosures(await api.adminCourtClosures());
      if (closure.id === entry.id) setClosure(newClosure());
    });
  }

  const loaded = periods && closures && courts && today;
  return <FacilityPage testId="admin-availability-view" title={t("admin.availability.title")}
                       error={error ?? clubError} success={success}>
    {loaded && <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="opening-periods-heading" className="grid content-start gap-4">
        <h2 id="opening-periods-heading" className="text-2xl font-bold">{t("admin.availability.periods")}</h2>
        <p className="text-sm text-[var(--cs-muted)]">{t("admin.availability.periodsHint")}</p>
        <EntryList testId="opening-periods" empty={t("admin.availability.noPeriods")}
          entries={periods.map((entry) => ({
            id: entry.id, prefix: "opening-period", label: t(`admin.availability.kind.${entry.kind}`), name: entry.name,
            startsOn: entry.startsOn, endsOn: entry.endsOn
          }))}
          today={today} disabled={pending.size > 0}
          edit={(id) => setPeriod(toDraft(periods.find((entry) => entry.id === id)!))}
          remove={(id) => removePeriod(periods.find((entry) => entry.id === id)!)} />
        <PeriodForm draft={period} today={today} started={!!editedPeriod && editedPeriod.startsOn < today}
                    disabled={pending.has("opening-period")} changed={setPeriod}
                    submit={(event) => void savePeriod(event)} cancel={() => setPeriod(newPeriod())} />
      </section>
      <section aria-labelledby="court-closures-heading" className="grid content-start gap-4">
        <h2 id="court-closures-heading" className="text-2xl font-bold">{t("admin.availability.closures")}</h2>
        <p className="text-sm text-[var(--cs-muted)]">{t("admin.availability.closuresHint")}</p>
        <EntryList testId="court-closures" empty={t("admin.availability.noClosures")}
          entries={closures.map((entry) => ({
            id: entry.id, prefix: "court-closure", label: courtLabel(courts, entry.courtId, t), name: entry.name,
            startsOn: entry.startsOn, endsOn: entry.endsOn
          }))}
          today={today} disabled={pending.size > 0}
          edit={(id) => setClosure({ ...closures.find((entry) => entry.id === id)! })}
          remove={(id) => removeClosure(closures.find((entry) => entry.id === id)!)} />
        <ClosureForm draft={closure} courts={courts} today={today}
                     started={!!editedClosure && editedClosure.startsOn < today}
                     disabled={pending.has("court-closure")} changed={setClosure}
                     submit={(event) => void saveClosure(event)} cancel={() => setClosure(newClosure())} />
      </section>
    </div>}
  </FacilityPage>;
}

type Entry = { id: string; prefix: string; label: string; name: string; startsOn: string; endsOn: string };

function EntryList({ testId, empty, entries, today, disabled, edit, remove }: {
  testId: string; empty: string; entries: Entry[]; today: string; disabled: boolean;
  edit: (id: string) => void; remove: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  if (entries.length === 0) return <p data-testid={`${testId}-empty`} className="text-[var(--cs-muted)]">{empty}</p>;
  return <ul data-testid={testId} className="grid gap-2">
    {entries.map((entry) => <li key={entry.id} data-testid={`${entry.prefix}-${entry.id}`}
      data-starts-on={entry.startsOn} data-ends-on={entry.endsOn}
      className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
      <span id={`${entry.prefix}-label-${entry.id}`} className="grid min-w-0 flex-1">
        <span className="font-medium">{entry.label}: {entry.name}</span>
        <span className="text-sm text-[var(--cs-muted)]">{formatDateRange(entry.startsOn, entry.endsOn, i18n.language)}</span>
      </span>
      {entry.endsOn >= today && <Button variant="secondary" type="button" data-testid={`edit-${entry.prefix}-${entry.id}`}
        aria-describedby={`${entry.prefix}-label-${entry.id}`} disabled={disabled} onClick={() => edit(entry.id)}>
        {t("admin.availability.edit")}</Button>}
      {entry.startsOn >= today && <Button variant="destructive" type="button" data-testid={`remove-${entry.prefix}-${entry.id}`}
        aria-describedby={`${entry.prefix}-label-${entry.id}`} disabled={disabled} onClick={() => remove(entry.id)}>
        {t("admin.availability.remove")}</Button>}
    </li>)}
  </ul>;
}

function PeriodForm({ draft, today, started, disabled, changed, submit, cancel }: {
  draft: PeriodDraft; today: string; started: boolean; disabled: boolean;
  changed: (draft: PeriodDraft) => void; submit: (event: FormEvent<HTMLFormElement>) => void; cancel: () => void;
}) {
  const { t } = useTranslation();
  const holiday = draft.kind === "HOLIDAY";
  const shown = holiday ? draft.days.slice(0, 1) : draft.days;
  function hours(day: Hours) {
    changed({ ...draft, days: holiday ? draft.days.map((other) => ({ ...day, dayOfWeek: other.dayOfWeek }))
      : draft.days.map((other) => other.dayOfWeek === day.dayOfWeek ? day : other) });
  }
  return <form data-testid="opening-period-form" noValidate onSubmit={submit} className="grid gap-3 rounded-xl border p-4">
    <h3 className="font-bold">{t(draft.id ? "admin.availability.editPeriod" : "admin.availability.newPeriod")}</h3>
    <label className="grid gap-2 font-medium">{t("admin.availability.kindLabel")}
      <select data-testid="opening-period-kind" className="form-control rounded-lg border px-3 py-3" value={draft.kind}
              disabled={disabled || started}
              onChange={(event) => changed(holidayHours({ ...draft, kind: event.target.value as Kind }))}>
        <option value="HOLIDAY">{t("admin.availability.kind.HOLIDAY")}</option>
        <option value="SEASON">{t("admin.availability.kind.SEASON")}</option>
      </select>
    </label>
    <TextField data-testid="opening-period-name" label={t("admin.availability.name")} maxLength={MAX_NAME} disabled={disabled}
               value={draft.name} onChange={(event) => changed({ ...draft, name: event.target.value })} />
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField data-testid="opening-period-starts-on" type="date" min={today} label={t("admin.availability.startsOn")}
                 disabled={disabled || started} value={draft.startsOn}
                 onChange={(event) => changed({ ...draft, startsOn: event.target.value })} />
      <TextField data-testid="opening-period-ends-on" type="date" min={draft.startsOn || today}
                 label={t("admin.availability.endsOn")} disabled={disabled} value={draft.endsOn}
                 onChange={(event) => changed({ ...draft, endsOn: event.target.value })} />
    </div>
    <fieldset className="grid gap-2" disabled={disabled || started}>
      <legend className="font-medium">{t(holiday ? "admin.availability.holidayHours" : "admin.availability.seasonHours")}</legend>
      {shown.map((day) => <HoursRow key={day.dayOfWeek} day={day} label={holiday ? undefined : t(`weekday.${day.dayOfWeek}`)}
                                    changed={hours} />)}
    </fieldset>
    {started && <p data-testid="opening-period-started" className="text-sm text-[var(--cs-muted)]">{t("admin.availability.startedHint")}</p>}
    <div className="flex flex-wrap gap-3">
      <Button variant="primary" type="submit" data-testid="save-opening-period" disabled={disabled}>{t("admin.availability.save")}</Button>
      {draft.id && <Button variant="secondary" type="button" data-testid="cancel-opening-period" disabled={disabled} onClick={cancel}>
        {t("admin.availability.cancel")}</Button>}
    </div>
  </form>;
}

function HoursRow({ day, label, changed }: { day: Hours; label?: string; changed: (day: Hours) => void }) {
  const { t } = useTranslation();
  return <div data-testid={`opening-period-hours-${day.dayOfWeek}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
    <TextField data-testid={`opening-period-opens-${day.dayOfWeek}`} type="time" disabled={day.closed}
               label={label ? `${label}, ${t("admin.facility.opensAt")}` : t("admin.facility.opensAt")} value={day.opensAt}
               onChange={(event) => changed({ ...day, opensAt: event.target.value })} />
    <TextField data-testid={`opening-period-closes-${day.dayOfWeek}`} type="time" disabled={day.closed}
               label={t("admin.facility.closesAt")} value={day.closesAt}
               onChange={(event) => changed({ ...day, closesAt: event.target.value })} />
    <label className="flex min-h-11 items-center gap-2 font-medium">
      <input data-testid={`opening-period-closed-${day.dayOfWeek}`} type="checkbox" checked={day.closed}
             onChange={(event) => changed(event.target.checked ? { ...day, opensAt: "", closesAt: "", closed: true } : { ...day, closed: false })} />
      {t("admin.facility.dayClosed")}
    </label>
  </div>;
}

function ClosureForm({ draft, courts, today, started, disabled, changed, submit, cancel }: {
  draft: ClosureDraft; courts: AdminCourt[]; today: string; started: boolean; disabled: boolean;
  changed: (draft: ClosureDraft) => void; submit: (event: FormEvent<HTMLFormElement>) => void; cancel: () => void;
}) {
  const { t } = useTranslation();
  return <form data-testid="court-closure-form" noValidate onSubmit={submit} className="grid gap-3 rounded-xl border p-4">
    <h3 className="font-bold">{t(draft.id ? "admin.availability.editClosure" : "admin.availability.newClosure")}</h3>
    <label className="grid gap-2 font-medium">{t("admin.availability.court")}
      <select data-testid="court-closure-court" className="form-control rounded-lg border px-3 py-3" value={draft.courtId}
              disabled={disabled || started} onChange={(event) => changed({ ...draft, courtId: event.target.value })}>
        <option value="">{t("admin.availability.chooseCourt")}</option>
        {courts.map((court) => <option key={court.id} value={court.id}>{courtLabel(courts, court.id, t)}</option>)}
      </select>
    </label>
    <TextField data-testid="court-closure-name" label={t("admin.availability.reason")} maxLength={MAX_NAME} disabled={disabled}
               value={draft.name} onChange={(event) => changed({ ...draft, name: event.target.value })} />
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField data-testid="court-closure-starts-on" type="date" min={today} label={t("admin.availability.startsOn")}
                 disabled={disabled || started} value={draft.startsOn}
                 onChange={(event) => changed({ ...draft, startsOn: event.target.value })} />
      <TextField data-testid="court-closure-ends-on" type="date" min={draft.startsOn || today}
                 label={t("admin.availability.endsOn")} disabled={disabled} value={draft.endsOn}
                 onChange={(event) => changed({ ...draft, endsOn: event.target.value })} />
    </div>
    <div className="flex flex-wrap gap-3">
      <Button variant="primary" type="submit" data-testid="save-court-closure" disabled={disabled}>{t("admin.availability.save")}</Button>
      {draft.id && <Button variant="secondary" type="button" data-testid="cancel-court-closure" disabled={disabled} onClick={cancel}>
        {t("admin.availability.cancel")}</Button>}
    </div>
  </form>;
}

function courtLabel(courts: AdminCourt[], courtId: string, t: ReturnType<typeof useTranslation>["t"]): string {
  const court = courts.find((candidate) => candidate.id === courtId);
  if (!court) return t("admin.availability.unknownCourt");
  return court.name ? `${t("court.number", { number: court.number })}, ${court.name}` : t("court.number", { number: court.number });
}

// A holiday holds one window for every weekday, so switching to it keeps Monday's for all.
function holidayHours(draft: PeriodDraft): PeriodDraft {
  if (draft.kind !== "HOLIDAY") return draft;
  return { ...draft, days: draft.days.map((day) => ({ ...draft.days[0], dayOfWeek: day.dayOfWeek })) };
}

function toDraft(period: OpeningPeriod): PeriodDraft {
  return {
    id: period.id, kind: period.kind, name: period.name, startsOn: period.startsOn, endsOn: period.endsOn,
    days: period.days.map((day) => ({
      dayOfWeek: day.dayOfWeek, opensAt: shortTime(day.opensAt), closesAt: shortTime(day.closesAt),
      closed: !day.opensAt && !day.closesAt
    }))
  };
}

function toRequest(period: PeriodDraft): OpeningHours[] {
  return period.days.map((day) => day.closed
    ? { dayOfWeek: day.dayOfWeek, opensAt: null, closesAt: null }
    : { dayOfWeek: day.dayOfWeek, opensAt: day.opensAt, closesAt: day.closesAt });
}
