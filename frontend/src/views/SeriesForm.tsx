import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  api, type CreateSeriesRequest, type DayOfWeek, type Occurrence, type PublicBookingCard,
  type PublicCourt, type SeriesCreated, type SeriesPreview, type SeriesRuleRequest
} from "../api/client";
import { Button } from "../components/Button";
import { SuccessFeedback } from "../components/SuccessFeedback";
import { TextField } from "../components/TextField";
import { formatBookingPeriod } from "../time/clubZone";

const WEEKDAYS: DayOfWeek[] = [
  "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"
];

type Ending = "occurrenceCount" | "endsOn";

interface Draft {
  courtIds: string[];
  cardId: string;
  startsOn: string;
  startTime: string;
  durationMinutes: number;
  intervalWeeks: number;
  weekdays: DayOfWeek[];
  ending: Ending;
  endsOn: string;
  occurrenceCount: number;
  note: string;
}

const EMPTY: Draft = {
  courtIds: [], cardId: "", startsOn: "", startTime: "", durationMinutes: 60, intervalWeeks: 1,
  weekdays: [], ending: "occurrenceCount", endsOn: "", occurrenceCount: 10, note: ""
};

function ruleOf(draft: Draft): SeriesRuleRequest {
  return {
    courtIds: draft.courtIds,
    cardId: draft.cardId,
    startsOn: draft.startsOn,
    startTime: draft.startTime,
    durationMinutes: draft.durationMinutes,
    intervalWeeks: draft.intervalWeeks,
    weekdays: draft.weekdays,
    endsOn: draft.ending === "endsOn" ? draft.endsOn : null,
    occurrenceCount: draft.ending === "occurrenceCount" ? draft.occurrenceCount : null,
    note: draft.note.trim() || null
  };
}

function isComplete(draft: Draft): boolean {
  const ending = draft.ending === "endsOn" ? draft.endsOn !== "" : draft.occurrenceCount > 0;
  return draft.courtIds.length > 0 && draft.cardId !== "" && draft.startsOn !== ""
    && draft.startTime !== "" && draft.weekdays.length > 0 && ending;
}

function chosenOf(preview: SeriesPreview): string[] {
  return preview.occurrences.filter((occurrence) => occurrence.creatable)
    .map((occurrence) => occurrence.startsAt);
}

export function SeriesForm({ timeZone, courts, created, reportError }: {
  timeZone: string;
  courts: PublicCourt[];
  created: () => Promise<void>;
  reportError: (failure: unknown) => void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState<PublicBookingCard[]>([]);
  const [maxBookingMinutes, setMaxBookingMinutes] = useState<number>();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [preview, setPreview] = useState<SeriesPreview>();
  const [chosen, setChosen] = useState<string[]>([]);
  const [result, setResult] = useState<SeriesCreated>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.bookingCards().then(setCards).catch(reportError);
    // A bound that cannot be read leaves the maximum unset; the server holds the rule regardless,
    // so failing to fill in a field's ceiling is not worth an error in front of the form.
    api.bookingEligibility()
      .then((eligibility) => setMaxBookingMinutes(eligibility.maxBookingMinutes ?? undefined))
      .catch(() => setMaxBookingMinutes(undefined));
  }, [open, reportError]);

  // A preview answers one rule, so editing the rule afterwards takes its confirmation with it.
  function change(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setPreview(undefined);
    setChosen([]);
    setResult(undefined);
  }

  async function readPreview() {
    setPending(true);
    try {
      const answer = await api.previewSeries(ruleOf(draft));
      setPreview(answer);
      setChosen(chosenOf(answer));
      setResult(undefined);
    } catch (failure) {
      reportError(failure);
    } finally {
      setPending(false);
    }
  }

  async function create() {
    setPending(true);
    try {
      const body: CreateSeriesRequest = { ...ruleOf(draft), confirmedStarts: chosen };
      setResult(await api.createSeries(body));
      setPreview(undefined);
      setChosen([]);
      await created();
    } catch (failure) {
      reportError(failure);
    } finally {
      setPending(false);
    }
  }

  function toggle(startsAt: string) {
    setChosen((current) => current.includes(startsAt)
      ? current.filter((held) => held !== startsAt)
      : [...current, startsAt]);
  }

  if (!open) {
    return <Button data-testid="new-series" className="mt-6 justify-self-start" type="button" onClick={() => setOpen(true)}>
      {t("series.new")}
    </Button>;
  }

  return <section className="surface-subtle mt-6 grid gap-4 rounded-xl border p-4" aria-labelledby="series-title">
    <h3 id="series-title" className="text-xl font-bold">{t("series.new")}</h3>

    <div className="grid gap-2">
      <label className="font-semibold" htmlFor="series-courts">{t("series.courts")}</label>
      <select data-testid="series-courts" id="series-courts" multiple size={Math.min(courts.length, 5)} className="form-control rounded-lg border p-2" disabled={pending} value={draft.courtIds} onChange={(event) => change({ courtIds: [...event.target.selectedOptions].map((option) => option.value) })}>
        {courts.map((court) => <option key={court.id} value={court.id}>{court.name ?? court.number}</option>)}
      </select>
      <p className="text-muted text-sm">{t("series.courtsHint")}</p>
    </div>

    <div className="grid gap-2">
      <label className="font-semibold" htmlFor="series-card">{t("series.card")}</label>
      <select data-testid="series-card" id="series-card" className="form-control rounded-lg border p-2" disabled={pending} value={draft.cardId} onChange={(event) => change({ cardId: event.target.value })}>
        <option value="">{t("series.chooseCard")}</option>
        {cards.map((card) => <option key={card.id} value={card.id}>{card.label}</option>)}
      </select>
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      <TextField data-testid="series-starts-on" disabled={pending} type="date" label={t("series.startsOn")} value={draft.startsOn} onChange={(event) => change({ startsOn: event.target.value })} />
      <TextField data-testid="series-start-time" disabled={pending} type="time" label={t("series.startTime")} value={draft.startTime} onChange={(event) => change({ startTime: event.target.value })} />
      <TextField data-testid="series-duration" disabled={pending} type="number" min={1} max={maxBookingMinutes ?? 1440} label={t("series.duration")} value={draft.durationMinutes} onChange={(event) => change({ durationMinutes: Number(event.target.value) })} />
      <TextField data-testid="series-interval-weeks" disabled={pending} type="number" min={1} max={52} label={t("series.intervalWeeks")} value={draft.intervalWeeks} onChange={(event) => change({ intervalWeeks: Number(event.target.value) })} />
    </div>

    <fieldset className="grid gap-2">
      <legend className="font-semibold">{t("series.weekdays")}</legend>
      <div className="flex flex-wrap gap-3">
        {WEEKDAYS.map((day) => <label key={day} className="flex items-center gap-2">
          <input data-testid={`series-weekday-${day}`} type="checkbox" disabled={pending} checked={draft.weekdays.includes(day)} onChange={(event) => change({ weekdays: event.target.checked ? [...draft.weekdays, day] : draft.weekdays.filter((held) => held !== day) })} />
          {t(`weekday.${day}`)}
        </label>)}
      </div>
    </fieldset>

    <div className="grid gap-2">
      <label className="font-semibold" htmlFor="series-ending">{t("series.ending")}</label>
      <select data-testid="series-ending" id="series-ending" className="form-control rounded-lg border p-2" disabled={pending} value={draft.ending} onChange={(event) => change({ ending: event.target.value as Ending })}>
        <option value="occurrenceCount">{t("series.ending.occurrenceCount")}</option>
        <option value="endsOn">{t("series.ending.endsOn")}</option>
      </select>
      {draft.ending === "occurrenceCount"
        ? <TextField data-testid="series-occurrence-count" disabled={pending} type="number" min={1} max={200} label={t("series.occurrenceCount")} value={draft.occurrenceCount} onChange={(event) => change({ occurrenceCount: Number(event.target.value) })} />
        : <TextField data-testid="series-ends-on" disabled={pending} type="date" label={t("series.endsOn")} value={draft.endsOn} onChange={(event) => change({ endsOn: event.target.value })} />}
    </div>

    <TextField data-testid="series-note" disabled={pending} label={t("series.note")} value={draft.note} onChange={(event) => change({ note: event.target.value })} />

    <div className="flex flex-wrap gap-3">
      <Button data-testid="preview-series" disabled={pending || !isComplete(draft)} type="button" onClick={() => void readPreview()}>
        {t("series.preview")}
      </Button>
      <Button data-testid="cancel-series" type="button" onClick={() => { setOpen(false); setDraft(EMPTY); setPreview(undefined); setChosen([]); setResult(undefined); }}>
        {t("admin.cancel")}
      </Button>
    </div>

    {preview && <div className="grid gap-3 border-t pt-4">
      <p data-testid="series-creatable-count">{t("series.creatable", { creatable: preview.creatableCount })}</p>
      {preview.truncatedByHorizon && <p data-testid="series-truncated">
        {t("series.truncated", { horizon: preview.horizonLimit })}
      </p>}
      <ul className="grid gap-1">
        {preview.occurrences.map((occurrence, index) => <li key={occurrence.startsAt} data-testid={`series-occurrence-${index}`}>
          <label className="flex flex-wrap items-center gap-2">
            <input data-testid={`series-occurrence-chosen-${index}`} type="checkbox" disabled={pending || !occurrence.creatable} checked={chosen.includes(occurrence.startsAt)} onChange={() => toggle(occurrence.startsAt)} />
            <span>{formatBookingPeriod(occurrence.startsAt, occurrence.endsAt, i18n.language, timeZone)}</span>
            {!occurrence.creatable && <span className="text-muted text-sm">{blockedBy(occurrence, t)}</span>}
          </label>
        </li>)}
      </ul>
      <Button data-testid="confirm-series" disabled={pending || chosen.length === 0} className="justify-self-start" type="button" onClick={() => void create()}>
        {t("series.create", { chosen: chosen.length })}
      </Button>
    </div>}

    {result && <SuccessFeedback testId="series-created"><div className="grid gap-1">
      <p>{t("series.created", { created: result.bookingIds.length })}</p>
      {result.skipped.length > 0 && <div data-testid="series-skipped">
        <p>{t("series.skipped", { skipped: result.skipped.length })}</p>
        <ul className="grid gap-1">
          {result.skipped.map((start) => <li key={start} data-testid={`series-skipped-${start}`}>
            {formatBookingPeriod(start, new Date(Date.parse(start) + draft.durationMinutes * 60_000).toISOString(), i18n.language, timeZone)}
          </li>)}
        </ul>
      </div>}
    </div></SuccessFeedback>}
  </section>;
}

function blockedBy(occurrence: Occurrence, t: (key: string, params?: Record<string, unknown>) => string): string {
  if (occurrence.violations.length > 0) {
    return occurrence.violations.map((violation) => t(violation.code, violation.params)).join(", ");
  }
  return t("series.courtTaken");
}
