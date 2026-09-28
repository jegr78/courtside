import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ApiError, api, type DayOfWeek, type OpeningHours, type OpeningWeek } from "../../api/client";
import { useClubConfiguration } from "../../club/registry";
import { Button } from "../../components/Button";
import { ImpactPanel } from "../../components/ImpactPanel";
import { TextField } from "../../components/TextField";
import { dateInTimeZoneValue, parseDate, shortTime } from "../../time/clubZone";
import { differs } from "../../unsaved/differs";
import { SaveBar } from "../../unsaved/SaveBar";
import { FacilityPage } from "./FacilityPage";
import { useSaving } from "./useSaving";
import { violationMessage } from "../../api/problem-message";

type WeekDay = { dayOfWeek: DayOfWeek; opensAt: string; closesAt: string; closed: boolean };
type Draft = { effectiveFrom: string; days: WeekDay[] };

const MARK = "opening-hours";
const FORM = "opening-hours-form";

export function AdminOpeningHoursView() {
  const { t } = useTranslation();
  const { club, error: clubError } = useClubConfiguration();
  const [weeks, setWeeks] = useState<OpeningWeek[]>();
  const [selected, setSelected] = useState(0);
  const [draft, setDraft] = useState<Draft>();
  const [confirmed, setConfirmed] = useState<Draft>();
  const [rejected, setRejected] = useState<Record<string, string>>({});
  const { error, success, pending, reportError, refuse, save } = useSaving();
  const timeZone = club?.timeZone;
  const today = useMemo(() => dateInTimeZoneValue(new Date(), timeZone), [timeZone]);

  const show = useCallback((loaded: OpeningWeek[], index: number, day: string) => {
    const chosen = Math.min(Math.max(index, 0), loaded.length - 1);
    const shown = toDraft(loaded[chosen], chosen === 0 ? day : undefined);
    setWeeks(loaded);
    setSelected(chosen);
    setDraft(shown);
    setConfirmed(shown);
    setRejected({});
  }, []);

  useEffect(() => {
    if (!today) return;
    void api.adminOpeningSchedule()
      .then((loaded) => show(loaded, 0, today))
      .catch(reportError);
  }, [today, show, reportError]);

  // A day somebody has since edited no longer carries the answer the server gave about it.
  function forget(days: Set<DayOfWeek>) {
    setRejected((current) =>
      Object.fromEntries(Object.entries(current).filter(([day]) => !days.has(day as DayOfWeek))));
  }

  function replace(changed: WeekDay) {
    setDraft((current) => current && {
      ...current, days: current.days.map((day) => day.dayOfWeek === changed.dayOfWeek ? changed : day)
    });
    forget(new Set([changed.dayOfWeek]));
  }

  function applyTo(days: Set<DayOfWeek>, opensAt: string, closesAt: string) {
    setDraft((current) => current && {
      ...current,
      days: current.days.map((day) => days.has(day.dayOfWeek) ? { ...day, opensAt, closesAt, closed: false } : day)
    });
    forget(days);
  }

  function saveWeek(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !confirmed || !weeks || !today) return Promise.resolve();
    if (!draft.effectiveFrom) {
      refuse(t("admin.facility.effectiveFromMissing"));
      return Promise.resolve();
    }
    const incomplete = incompleteDays(draft.days, t);
    if (Object.keys(incomplete).length > 0) {
      setRejected(incomplete);
      refuse(t("admin.facility.dayNeedsBothTimes"));
      return Promise.resolve();
    }
    const moved = selected > 0 && draft.effectiveFrom !== confirmed.effectiveFrom ? confirmed.effectiveFrom : undefined;
    return save(MARK, async () => {
      try {
        await api.setAdminWeeklyOpeningHours(draft.effectiveFrom, draft.days.map(toRequest));
      } catch (failure) {
        setRejected(rejectedDays(failure, t));
        throw failure;
      }
      try {
        if (moved) await api.removeScheduledOpeningHours(moved);
      } finally {
        const loaded = await api.adminOpeningSchedule();
        show(loaded, loaded.findIndex((week) => week.effectiveFrom === draft.effectiveFrom), today);
      }
    });
  }

  function remove(effectiveFrom: string) {
    if (!today) return;
    void save(`${MARK}-${effectiveFrom}`, async () => {
      await api.removeScheduledOpeningHours(effectiveFrom);
      show(await api.adminOpeningSchedule(), 0, today);
    });
  }

  function discard() {
    setDraft(confirmed);
    setRejected({});
  }

  const unsaved = differs({ draft }, { draft: confirmed });
  const saving = pending.size > 0;
  return <FacilityPage testId="admin-opening-hours-view" title={t("admin.facility.openingHours")} error={error ?? clubError} success={success}>
    {weeks !== undefined && draft !== undefined && club !== undefined && today !== undefined && <div className="grid gap-4">
      <OpeningWeeks weeks={weeks} selected={selected} disabled={saving || unsaved}
                    choose={(index) => show(weeks, index, today)} remove={remove} />
      <form id={FORM} noValidate onSubmit={(event) => void saveWeek(event)} className="grid gap-4">
        <article className="grid gap-2 rounded-xl border p-4">
          <TextField disabled={saving} data-testid="opening-hours-effective-from" type="date" min={today} required
                     label={t("admin.facility.effectiveFrom")} value={draft.effectiveFrom}
                     onChange={(event) => setDraft({ ...draft, effectiveFrom: event.target.value })} />
          <p data-testid="opening-hours-effective-from-hint" className="text-sm text-[var(--cs-muted)]">
            {t(selected === 0 ? "admin.facility.effectiveFromHint" : "admin.facility.effectiveFromScheduledHint")}
          </p>
        </article>
        <ApplyToDays disabled={saving} apply={applyTo} />
        <div className="grid gap-3 lg:grid-cols-2">
          {draft.days.map((day) => <DayEditor
            key={day.dayOfWeek}
            day={day}
            effectiveFrom={draft.effectiveFrom}
            timeZone={club.timeZone}
            disabled={saving}
            rejected={rejected[day.dayOfWeek]}
            changed={replace}
            reportError={reportError}
          />)}
        </div>
        <SaveBar id={MARK} subject={t("admin.facility.openingHours")} saveTestId="save-opening-hours" form={FORM}
                 unsaved={unsaved} pending={pending.has(MARK)} discard={discard} />
      </form>
    </div>}
  </FacilityPage>;
}

function OpeningWeeks({ weeks, selected, disabled, choose, remove }: {
  weeks: OpeningWeek[];
  selected: number;
  disabled: boolean;
  choose: (index: number) => void;
  remove: (effectiveFrom: string) => void;
}) {
  const { t, i18n } = useTranslation();
  return <article className="grid gap-3 rounded-xl border p-4">
    <h2 className="font-bold">{t("admin.facility.openingWeeks")}</h2>
    <ul data-testid="opening-weeks" className="grid gap-2">
      {weeks.map((week, index) => {
        const key = week.effectiveFrom ?? "beginning";
        return <li key={week.id} data-testid={`opening-week-${key}`} className="flex flex-wrap items-center gap-3">
          <span className="font-medium">{index === 0
            ? week.effectiveFrom
              ? t("admin.facility.inForceSince", { date: formatDay(week.effectiveFrom, i18n.language) })
              : t("admin.facility.inForceFromTheBeginning")
            : t("admin.facility.scheduledFrom", { date: formatDay(week.effectiveFrom ?? "", i18n.language) })}</span>
          <Button variant="secondary" type="button" data-testid={`edit-opening-week-${key}`} aria-pressed={index === selected}
                  disabled={disabled} onClick={() => choose(index)}>{t("admin.facility.editWeek")}</Button>
          {index > 0 && week.effectiveFrom && <Button variant="secondary" type="button" data-testid={`remove-opening-week-${key}`}
                  disabled={disabled} onClick={() => remove(week.effectiveFrom!)}>{t("admin.facility.removeWeek")}</Button>}
        </li>;
      })}
    </ul>
  </article>;
}

function formatDay(date: string, language: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(parseDate(date));
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

  return <article className="grid gap-3 rounded-xl border p-4">
    <h2 className="font-bold">{t("admin.facility.applyToDays")}</h2>
    <p data-testid="apply-to-days-hint" className="text-sm text-[var(--cs-muted)]">{t("admin.facility.applyToDaysHint")}</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField disabled={disabled} data-testid="apply-opens-at" type="time" label={t("admin.facility.opensAt")} value={opensAt} onChange={(event) => setOpensAt(event.target.value)} />
      <TextField disabled={disabled} data-testid="apply-closes-at" type="time" label={t("admin.facility.closesAt")} value={closesAt} onChange={(event) => setClosesAt(event.target.value)} />
    </div>
    <fieldset className="grid gap-2">
      <legend className="font-medium">{t("admin.facility.applyDays")}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {weekdays.map((day) => <label key={day} className="flex items-center gap-2 font-medium">
          <input data-testid={`apply-day-${day}`} disabled={disabled} type="checkbox" checked={days.has(day)} onChange={(event) => toggle(day, event.target.checked)} />
          {t(`weekday.${day}`)}
        </label>)}
      </div>
    </fieldset>
    <Button variant="secondary" data-testid="apply-hours" className="justify-self-start" disabled={disabled || days.size === 0 || !opensAt || !closesAt} type="button" onClick={() => apply(days, opensAt, closesAt)}>{t("admin.facility.apply")}</Button>
  </article>;
}

function DayEditor({ day, effectiveFrom, timeZone, disabled, rejected, changed, reportError }: { day: WeekDay; effectiveFrom: string; timeZone: string; disabled: boolean; rejected?: string; changed: (day: WeekDay) => void; reportError: (failure: unknown) => void }) {
  const { t } = useTranslation();
  const errorId = `hours-error-${day.dayOfWeek}`;
  return <article className="grid gap-3 rounded-xl border p-4">
    <h2 className="font-bold">{t(`weekday.${day.dayOfWeek}`)}</h2>
    <div className="grid grid-cols-2 gap-3">
      <TextField disabled={disabled || day.closed} data-testid={`hours-open-${day.dayOfWeek}`} type="time" aria-describedby={rejected ? errorId : undefined} label={t("admin.facility.opensAt")} value={day.opensAt} onChange={(event) => changed({ ...day, opensAt: event.target.value })} />
      <TextField disabled={disabled || day.closed} data-testid={`hours-close-${day.dayOfWeek}`} type="time" aria-describedby={rejected ? errorId : undefined} label={t("admin.facility.closesAt")} value={day.closesAt} onChange={(event) => changed({ ...day, closesAt: event.target.value })} />
    </div>
    <label className="flex items-center gap-2 font-medium">
      <input data-testid={`hours-closed-${day.dayOfWeek}`} disabled={disabled} type="checkbox" checked={day.closed} onChange={(event) => changed(event.target.checked ? { ...day, opensAt: "", closesAt: "", closed: true } : { ...day, closed: false })} />
      {t("admin.facility.dayClosed")}
    </label>
    {rejected && <p id={errorId} data-testid={errorId} className="text-destructive text-sm">{rejected}</p>}
    <ImpactPanel
      kind="opening-hours"
      subject={day.dayOfWeek}
      timeZone={timeZone}
      ask={() => api.openingHoursImpact(day.dayOfWeek, effectiveFrom, day.opensAt || undefined, day.closesAt || undefined)}
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

function toDraft(week: OpeningWeek, today?: string): Draft {
  return { effectiveFrom: today ?? week.effectiveFrom ?? "", days: week.days.map(toWeekDay) };
}

function toRequest(day: WeekDay): OpeningHours {
  return day.closed
    ? { dayOfWeek: day.dayOfWeek, opensAt: null, closesAt: null }
    : { dayOfWeek: day.dayOfWeek, opensAt: day.opensAt, closesAt: day.closesAt };
}

// A day the wire cannot express: neither a window nor a closure, so the form says so rather than
// sending a body that would silently arrive as one of the two.
function incompleteDays(days: WeekDay[], t: TFunction): Record<string, string> {
  const marked: Record<string, string> = {};
  days.filter((day) => !day.closed && (!day.opensAt || !day.closesAt))
    .forEach((day) => { marked[day.dayOfWeek] = t("openingWindow.incomplete"); });
  return marked;
}

function rejectedDays(failure: unknown, t: TFunction): Record<string, string> {
  if (!(failure instanceof ApiError)) return {};
  const marked: Record<string, string> = {};
  for (const violation of failure.problem?.violations ?? []) {
    const day = violation.params?.day;
    if (typeof day === "string") {
      marked[day] = violationMessage(violation.code, violation.params, t);
    }
  }
  return marked;
}
