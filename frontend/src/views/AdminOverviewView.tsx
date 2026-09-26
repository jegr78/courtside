import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, type Allocation, type AuditPage, type CredentialState, type MessagePage, type PublicCourt,
  type RosterPage, type StatisticsPeriodQuery } from "../api/client";
import { actorLabel, auditMessage } from "../audit/auditText";
import { allocationLabel } from "../booking/allocationLabel";
import { useClubConfiguration } from "../club/registry";
import { LoadFailure } from "../components/LoadFailure";
import { useRetry } from "../failures/useRetry";
import { useReportedFailure } from "../failures/useReportedFailure";
import { addDays, dateInTimeZone, dateInTimeZoneValue, formatBookingTimeRange, formatDate, formatDateTime,
  startOfWeek } from "../time/clubZone";
import { SetupProgress, SetupSteps } from "./setup/SetupChecklist";
import { REQUIRED_STEPS, useSetupSteps } from "./setup/useSetupSteps";

const SHOWN = 5;
const NOT_CHOSEN: CredentialState[] = ["AWAITING_CREDENTIAL", "CREDENTIAL_ISSUED", "CREDENTIAL_EXPIRED"];
const systemClock = () => new Date();

function useRead<T>(read: (() => Promise<T>) | undefined) {
  const { message: error, report, clear } = useReportedFailure();
  const [value, setValue] = useState<T>();
  const [attempt, retry] = useRetry();

  useEffect(() => {
    if (!read) return;
    let active = true;
    void read()
      .then((result) => {
        if (active) setValue(result);
      })
      .catch((failure: unknown) => {
        if (active) report(failure);
      });
    return () => {
      active = false;
    };
  }, [attempt, read, report]);

  return { value, error, retry: () => { clear(); retry(); } };
}

function Card<T>({ testId, title, link, read, children }: {
  testId: string;
  title: string;
  link: { to: string; label: string };
  read: { value?: T; error?: string; retry: () => void };
  children: (value: T) => ReactNode;
}) {
  const { t } = useTranslation();
  return <section data-testid={testId} aria-labelledby={`${testId}-heading`} className="surface-raised grid content-start gap-3 rounded-xl border p-5">
    <h2 id={`${testId}-heading`} className="text-xl font-bold">{title}</h2>
    {read.value === undefined
      ? read.error ? <LoadFailure message={read.error} retry={read.retry} /> : <p role="status">{t("status.loading")}</p>
      : children(read.value)}
    <Link data-testid={`${testId}-link`} to={link.to} className="justify-self-start font-semibold underline">{link.label}</Link>
  </section>;
}

type Trend = "up" | "down" | "unchanged";

interface Figure {
  value: string;
  detail?: string;
  change?: { trend: Trend; count: number };
}

function changeBetween(current: number, previous: number | null | undefined): Figure["change"] {
  if (previous === null || previous === undefined) return undefined;
  const difference = current - previous;
  return { trend: difference > 0 ? "up" : difference < 0 ? "down" : "unchanged", count: Math.abs(difference) };
}

function periodEndingOn(today: Date, days: number): StatisticsPeriodQuery {
  return { from: formatDate(addDays(today, 1 - days)), to: formatDate(today) };
}

function KeyFigure({ name, period, read, figure }: {
  name: string;
  period: StatisticsPeriodQuery;
  read: { error?: string; retry: () => void; loaded: boolean };
  figure?: Figure;
}) {
  const { t } = useTranslation();
  const testId = `overview-figure-${name}`;
  const label = <span className="text-muted text-sm font-semibold">{t(`admin.overview.figures.${name}.label`)}</span>;
  const tile = "surface-raised grid content-start gap-1 rounded-xl border p-4";
  if (!read.loaded || !figure) {
    return <div data-testid={testId} className={tile}>
      {label}
      {read.error ? <LoadFailure message={read.error} retry={read.retry} /> : <p role="status">{t("status.loading")}</p>}
    </div>;
  }
  const { value, detail, change } = figure;
  return <Link data-testid={testId} to={`/admin/utilisation?${new URLSearchParams(period).toString()}`}
    className={`${tile} focus-ring hover:border-[var(--cs-accent)]`}>
    {label}
    <span data-testid={`${testId}-value`} className="text-3xl font-bold tabular-nums">{value}</span>
    {detail && <span data-testid={`${testId}-detail`} className="text-sm">{detail}</span>}
    {change && <span data-testid={`${testId}-change`} data-trend={change.trend} className="text-muted text-sm">
      {change.trend !== "unchanged" && <span aria-hidden="true">{change.trend === "up" ? "▲ " : "▼ "}</span>}
      {t(`admin.overview.figures.${name}.${change.trend}`, { count: change.count })}
    </span>}
  </Link>;
}

function KeyFigures({ clock }: { clock: () => Date }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const { club, error: clubError, load: loadClub } = useClubConfiguration();
  const timeZone = club?.timeZone;
  const periods = useMemo(() => {
    if (!timeZone) return undefined;
    const today = dateInTimeZone(clock(), timeZone);
    const monday = startOfWeek(today);
    return {
      week: { from: formatDate(monday), to: formatDate(addDays(monday, 6)) },
      sevenDays: periodEndingOn(today, 7),
      thirtyDays: periodEndingOn(today, 30)
    };
  }, [clock, timeZone]);
  const utilisation = useRead(useMemo(() => periods && (() => api.utilisationStatistics(periods.sevenDays)), [periods]));
  const bookings = useRead(useMemo(() => periods && (() => api.bookingStatistics(periods.week)), [periods]));
  const members = useRead(useMemo(() => periods && (() => api.memberStatistics(periods.thirtyDays)), [periods]));
  if (!periods) {
    return clubError ? <LoadFailure message={clubError} retry={loadClub} /> : <p role="status">{t("status.loading")}</p>;
  }

  const count = new Intl.NumberFormat(language);
  const percent = new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 0 });
  const points = (share: number | null | undefined) => share === null || share === undefined ? share : Math.round(share * 100);
  const state = <T,>(read: { value?: T; error?: string; retry: () => void }) =>
    ({ loaded: read.value !== undefined, error: read.error, retry: read.retry });

  const occupancy = utilisation.value?.totals.occupancy;
  const current = members.value?.figures;
  const previous = members.value?.previous?.figures;
  return <section aria-labelledby="overview-figures-heading" data-testid="overview-figures" className="grid gap-3">
    <h2 id="overview-figures-heading" className="sr-only">{t("admin.overview.figures.title")}</h2>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <KeyFigure name="utilisation" period={periods.sevenDays} read={state(utilisation)} figure={utilisation.value && {
        value: occupancy === null || occupancy === undefined ? "–" : percent.format(occupancy),
        change: occupancy === null || occupancy === undefined ? undefined
          : changeBetween(points(occupancy)!, points(utilisation.value.previous?.totals.occupancy))
      }} />
      <KeyFigure name="bookings" period={periods.week} read={state(bookings)} figure={bookings.value && {
        value: count.format(bookings.value.figures.confirmed),
        change: changeBetween(bookings.value.figures.confirmed, bookings.value.previous?.figures.confirmed)
      }} />
      <KeyFigure name="active" period={periods.thirtyDays} read={state(members)} figure={current && {
        value: count.format(current.activeMembers),
        detail: current.activeShare === null ? undefined
          : t("admin.overview.figures.active.detail", { share: percent.format(current.activeShare) }),
        change: changeBetween(current.activeMembers, previous?.activeMembers)
      }} />
      <KeyFigure name="members" period={periods.thirtyDays} read={state(members)} figure={current && {
        value: count.format(current.members),
        detail: t("admin.overview.figures.members.detail", { count: current.joins }),
        change: changeBetween(current.members, previous?.members)
      }} />
    </div>
  </section>;
}

function SetupSection() {
  const { t } = useTranslation();
  const { steps, completed, error, retry } = useSetupSteps();
  if (!steps) {
    return error
      ? <div data-testid="overview-setup-failure"><LoadFailure message={error} retry={retry} /></div>
      : <p role="status">{t("status.loading")}</p>;
  }
  const complete = completed === REQUIRED_STEPS;
  return <details data-testid="overview-setup" open={!complete} className="group rounded-xl border p-5">
    <summary data-testid="overview-setup-summary" className="focus-ring flex cursor-pointer items-center justify-between gap-3 rounded-lg">
      <h2 className="text-xl font-bold">{complete ? t("admin.overview.setup.complete", { total: REQUIRED_STEPS }) : t("admin.overview.setup.title")}</h2>
      <span aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180">▾</span>
    </summary>
    <div className="mt-4 grid gap-4">
      <SetupProgress completed={completed} />
      <SetupSteps steps={steps} headingLevel={3} />
      <Link data-testid="overview-setup-link" to="/admin/setup" className="justify-self-start font-semibold underline">
        {t("admin.overview.setup.open")}
      </Link>
    </div>
  </details>;
}

interface Today {
  allocations: Allocation[];
  courts: PublicCourt[];
  now: number;
}

function TodayCard({ clock }: { clock: () => Date }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const { club, error: clubError, load: loadClub } = useClubConfiguration();
  const timeZone = club?.timeZone;
  const read = useCallback(async (): Promise<Today> => {
    const now = clock();
    const [allocations, courts] = await Promise.all([api.allocations(dateInTimeZoneValue(now, timeZone)!), api.courts()]);
    return { allocations, courts, now: now.getTime() };
  }, [clock, timeZone]);
  const today = useRead(timeZone ? read : undefined);
  const failure = today.error ?? (timeZone ? undefined : clubError);
  return <Card testId="overview-today" title={t("admin.overview.today.title")}
    link={{ to: "/", label: t("admin.overview.today.link") }}
    read={{ value: timeZone ? today.value : undefined, error: failure, retry: () => { loadClub(); today.retry(); } }}>
    {({ allocations, courts, now }) => {
      if (allocations.length === 0) return <p data-testid="overview-today-empty">{t("admin.overview.today.empty")}</p>;
      const bookings = new Set(allocations.map((allocation) => allocation.bookingId)).size;
      const names = new Map(courts.map((court) => [court.id, court.name || t("court.number", { number: court.number })]));
      const upcoming = allocations
        .filter((allocation) => Date.parse(allocation.endsAt) > now)
        .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt)
          || (names.get(left.courtId) ?? "").localeCompare(names.get(right.courtId) ?? "", language))
        .slice(0, SHOWN);
      return <>
        <p data-testid="overview-today-count" className="font-semibold">{t("admin.overview.today.count", { count: bookings })}</p>
        {upcoming.length === 0
          ? <p data-testid="overview-today-over" className="text-muted">{t("admin.overview.today.over")}</p>
          : <>
            <h3 className="text-muted text-sm font-bold">{t("admin.overview.today.upcoming")}</h3>
            <ul className="grid gap-2">
              {upcoming.map((allocation) => <li key={`${allocation.bookingId}-${allocation.courtId}`} data-testid="overview-today-entry"
                data-booking-id={allocation.bookingId} data-court-id={allocation.courtId} className="grid gap-0.5">
                <span className="font-mono text-sm tabular-nums">{formatBookingTimeRange(allocation.startsAt, allocation.endsAt, language, timeZone!)}</span>
                <span className="[overflow-wrap:anywhere]">{[names.get(allocation.courtId), allocationLabel(allocation, t)].filter(Boolean).join(" · ")}</span>
              </li>)}
            </ul>
          </>}
      </>;
    }}
  </Card>;
}

const readCredentials = () => api.roster({ limit: SHOWN, credentialStates: NOT_CHOSEN });

function CredentialsCard() {
  const { t } = useTranslation();
  const read = useRead<RosterPage>(readCredentials);
  return <Card testId="overview-credentials" title={t("admin.overview.credentials.title")}
    link={{ to: "/admin/roster?access=NOT_CHOSEN", label: t("admin.overview.credentials.link") }} read={read}>
    {(page) => page.matching === 0
      ? <p data-testid="overview-credentials-empty">{t("admin.overview.credentials.empty")}</p>
      : <>
        <p data-testid="overview-credentials-count" className="font-semibold">{t("admin.overview.credentials.count", { count: page.matching })}</p>
        <ul className="grid gap-2">
          {page.entries.map((entry) => <li key={entry.personId} data-testid="overview-credentials-entry" className="grid gap-0.5">
            <Link to={`/admin/roster/${entry.personId}`} className="underline [overflow-wrap:anywhere]">{entry.firstName} {entry.lastName}</Link>
            {entry.credentialState && <span className="text-muted text-sm">{t(`admin.roster.credential.${entry.credentialState}`)}</span>}
          </li>)}
        </ul>
      </>}
  </Card>;
}

const readMessages = () => api.messages(undefined, SHOWN, { unsettled: true });

function MessagesCard() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const { club } = useClubConfiguration();
  const read = useRead<MessagePage>(readMessages);
  return <Card testId="overview-messages" title={t("admin.overview.messages.title")}
    link={{ to: "/admin/messages?unsettled=true", label: t("admin.overview.messages.link") }} read={read}>
    {(page) => page.entries.length === 0
      ? <p data-testid="overview-messages-empty">{t("admin.overview.messages.empty")}</p>
      : <>
        <p data-testid="overview-messages-count" className="font-semibold">
          {page.nextCursor
            ? t("admin.overview.messages.more", { count: page.entries.length })
            : t("admin.overview.messages.count", { count: page.entries.length })}
        </p>
        <ul className="grid gap-2">
          {page.entries.map((entry) => <li key={entry.id} data-testid="overview-messages-entry" className="grid gap-0.5">
            <Link to={`/admin/roster/${entry.personId}`} className="underline [overflow-wrap:anywhere]">{entry.personName}</Link>
            <span className="text-muted text-sm">
              {t(`messages.kind.${entry.kind}`)} · {t(`messages.state.${entry.state}`)}
              {club && <> · {formatDateTime(entry.queuedAt, language, club.timeZone)}</>}
            </span>
          </li>)}
        </ul>
      </>}
  </Card>;
}

const readChanges = () => api.audit(undefined, SHOWN);

function ChangesCard() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const { club } = useClubConfiguration();
  const read = useRead<AuditPage>(readChanges);
  return <Card testId="overview-changes" title={t("admin.overview.changes.title")}
    link={{ to: "/admin/audit", label: t("admin.overview.changes.link") }} read={read}>
    {(page) => page.entries.length === 0
      ? <p data-testid="overview-changes-empty">{t("admin.overview.changes.empty")}</p>
      : <ul className="grid gap-2">
        {page.entries.map((entry) => <li key={entry.id} data-testid="overview-changes-entry" className="grid gap-0.5">
          <span className="[overflow-wrap:anywhere]">{auditMessage(entry, t)}</span>
          <span className="text-muted text-sm [overflow-wrap:anywhere]">
            {actorLabel(entry, t)}
            {club && <> · {formatDateTime(entry.occurredAt, language, club.timeZone)}</>}
          </span>
        </li>)}
      </ul>}
  </Card>;
}

export function AdminOverviewView({ clock = systemClock }: { clock?: () => Date }) {
  const { t } = useTranslation();
  return <section data-testid="admin-overview-view" className="surface-panel grid gap-6 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <div className="grid gap-2">
      <h1 className="text-3xl font-bold">{t("admin.overview.title")}</h1>
      <p className="text-muted">{t("admin.overview.description")}</p>
    </div>
    <SetupSection />
    <KeyFigures clock={clock} />
    <div className="grid gap-4 md:grid-cols-2">
      <TodayCard clock={clock} />
      <CredentialsCard />
      <MessagesCard />
      <ChangesCard />
    </div>
  </section>;
}
