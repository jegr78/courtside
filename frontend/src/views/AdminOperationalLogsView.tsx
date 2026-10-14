import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  api, type OperationalLogEntry, type OperationalLogPage, type OperationalLogSearchRequest
} from "../api/client";
import { problemMessage } from "../api/problem-message";
import { useClubConfiguration } from "../club/registry";
import { Alert } from "../components/Alert";
import { LoadFailure } from "../components/LoadFailure";
import { ScrollRegion } from "../components/ScrollRegion";
import { useRetry } from "../failures/useRetry";
import { Button } from "../components/Button";
import { DateTimeInput } from "../components/DateTimeInput";
import { formatDateTime, zonedDateTime } from "../time/clubZone";

interface Filters {
  source: string;
  severity: string;
  from: string;
  to: string;
  text: string;
  traceId: string;
}

const emptyFilters: Filters = { source: "", severity: "", from: "", to: "", text: "", traceId: "" };

function instantFor(value: string, timeZone: string): string {
  const [date, time] = value.split("T");
  return zonedDateTime(date, time, timeZone);
}

function requestFor(filters: Filters, timeZone: string, cursor?: string): OperationalLogSearchRequest {
  return {
    ...(filters.source ? { source: filters.source as OperationalLogSearchRequest["source"] } : {}),
    ...(filters.severity ? { severity: filters.severity as OperationalLogSearchRequest["severity"] } : {}),
    ...(filters.from ? { from: instantFor(filters.from, timeZone) } : {}),
    ...(filters.to ? { to: instantFor(filters.to, timeZone) } : {}),
    ...(filters.text.trim() ? { text: filters.text.trim() } : {}),
    ...(filters.traceId.trim() ? { traceId: filters.traceId.trim() } : {}),
    ...(cursor ? { cursor } : {}),
    limit: 50
  };
}

export function AdminOperationalLogsView() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const { club, error: clubError, load: loadClub } = useClubConfiguration();
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState<OperationalLogPage>();
  const [entries, setEntries] = useState<OperationalLogEntry[]>([]);
  const [error, setError] = useState<string>();
  const [refusedFilter, setRefusedFilter] = useState<string>();
  const [pending, setPending] = useState(false);
  const [loadAttempt, retryLoad] = useRetry();

  const reportError = useCallback((failure: unknown) => setError(problemMessage(failure, t)), [t]);
  const reportErrorRef = useRef(reportError);
  useEffect(() => { reportErrorRef.current = reportError; }, [reportError]);

  useEffect(() => {
    if (!club) return;
    let criteria: OperationalLogSearchRequest;
    try {
      criteria = requestFor(filters, club.timeZone);
    } catch (failure) {
      if (failure instanceof RangeError) {
        setRefusedFilter(t("operationalLogs.time.invalid"));
        return;
      }
      throw failure;
    }
    setRefusedFilter(undefined);
    setPage(undefined);
    setEntries([]);
    let active = true;
    void api.operationalLogs(criteria)
      .then((result) => {
        if (!active) return;
        setPage(result);
        setEntries(result.entries);
        setError(undefined);
      })
      .catch((failure: unknown) => { if (active) reportErrorRef.current(failure); });
    return () => { active = false; };
  }, [club, filters, loadAttempt, t]);

  function change(name: keyof Filters, value: string) {
    setDraft((current) => ({ ...current, [name]: value }));
  }

  async function readNextPage() {
    if (pending || !page?.nextCursor) return;
    setPending(true);
    try {
      if (!club) return;
      const next = await api.operationalLogs(requestFor(filters, club.timeZone, page.nextCursor));
      setEntries((current) => [...current, ...next.entries]);
      setPage(next);
      setError(undefined);
    } catch (failure) {
      reportError(failure);
    } finally {
      setPending(false);
    }
  }

  const problem = error ?? clubError;
  const cell = "grid min-w-0 grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3 sm:table-cell sm:border-t sm:p-2";
  const cellLabel = "font-medium sm:hidden";
  return <section data-testid="admin-operational-logs-view" className="surface-panel grid gap-8 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <div className="grid gap-2">
      <h1 className="text-3xl font-bold">{t("operationalLogs.title")}</h1>
      <p className="text-muted max-w-3xl">{t("operationalLogs.introduction")}</p>
    </div>
    <form className="grid gap-4 lg:grid-cols-3" onSubmit={(event) => { event.preventDefault(); setFilters({ ...draft }); }}>
      <label className="grid gap-2 font-semibold">{t("operationalLogs.filter.source")}
        <select data-testid="operational-log-source-filter" className="form-control rounded-lg border px-3 py-2" value={draft.source} onChange={(event) => change("source", event.target.value)}>
          <option value="">{t("operationalLogs.filter.all")}</option>
          {(["APPLICATION", "DATABASE", "PROXY"] as const).map((source) => <option key={source} value={source}>{t(`operationalLogs.source.${source}`)}</option>)}
        </select>
      </label>
      <label className="grid gap-2 font-semibold">{t("operationalLogs.filter.severity")}
        <select data-testid="operational-log-severity-filter" className="form-control rounded-lg border px-3 py-2" value={draft.severity} onChange={(event) => change("severity", event.target.value)}>
          <option value="">{t("operationalLogs.filter.all")}</option>
          {(["ERROR", "WARN", "INFO", "DEBUG", "UNKNOWN"] as const).map((severity) => <option key={severity} value={severity}>{t(`operationalLogs.severity.${severity}`)}</option>)}
        </select>
      </label>
      <label className="grid gap-2 font-semibold">{t("operationalLogs.filter.text")}
        <input data-testid="operational-log-text-filter" className="form-control rounded-lg border px-3 py-2" maxLength={200} value={draft.text} onChange={(event) => change("text", event.target.value)} />
      </label>
      <label className="grid gap-2 font-semibold">{t("operationalLogs.filter.trace")}
        <input data-testid="operational-log-trace-filter" className="form-control rounded-lg border px-3 py-2 font-mono" minLength={32} maxLength={32} pattern="[A-Fa-f0-9]{32}" value={draft.traceId} onChange={(event) => change("traceId", event.target.value)} />
      </label>
      <label className="grid gap-2 font-semibold">{t("operationalLogs.filter.from")}
        <DateTimeInput data-testid="operational-log-from-filter" type="datetime-local" className="form-control rounded-lg border px-3 py-2" value={draft.from} onChange={(event) => change("from", event.target.value)} />
      </label>
      <label className="grid gap-2 font-semibold">{t("operationalLogs.filter.to")}
        <DateTimeInput data-testid="operational-log-to-filter" type="datetime-local" className="form-control rounded-lg border px-3 py-2" value={draft.to} onChange={(event) => change("to", event.target.value)} />
      </label>
      <div className="flex flex-wrap gap-3 lg:col-span-3">
        <Button variant="primary" data-testid="operational-log-apply" type="submit">{t("operationalLogs.filter.apply")}</Button>
        <Button variant="secondary" type="button" onClick={() => { setDraft(emptyFilters); setFilters(emptyFilters); }}>{t("operationalLogs.filter.clear")}</Button>
      </div>
    </form>
    {refusedFilter && <Alert testId="operational-logs-filter-refused">{refusedFilter}</Alert>}
    {!page || !club
      ? (problem ? <LoadFailure message={problem} retry={() => { setError(undefined); loadClub(); retryLoad(); }} /> : !refusedFilter && <p role="status">{t("status.loading")}</p>)
      : <>
        {problem && <Alert testId="operational-logs-problem">{problem}</Alert>}
        {page.availability === "UNAVAILABLE"
          ? <Alert testId="operational-logs-unavailable">{t("operationalLogs.unavailable")}</Alert>
          : <>
            <Alert tone="info" testId="operational-logs-provenance-warning">{t("operationalLogs.provenanceWarning")}</Alert>
            {page.retentionTruncated && <Alert tone="info" testId="operational-logs-retention-warning">{t("operationalLogs.retentionWarning")}</Alert>}
            {page.searchIncomplete && <Alert tone="warning" testId="operational-logs-incomplete-warning">{t("operationalLogs.incompleteWarning")}</Alert>}
            {page.droppedRecords > 0 && <Alert tone="warning" testId="operational-logs-dropped-warning">{t("operationalLogs.droppedWarning", { count: page.droppedRecords })}</Alert>}
            {entries.length === 0
              ? <p data-testid="operational-logs-empty">{t("operationalLogs.empty")}</p>
              : <ScrollRegion subject={t("operationalLogs.title")} testId="operational-logs-scroll"><table role="table" className="block w-full text-left sm:table">
                <thead role="rowgroup" className="sr-only sm:not-sr-only"><tr role="row">
                  <th role="columnheader" scope="col" className="p-2">{t("operationalLogs.column.time")}</th>
                  <th role="columnheader" scope="col" className="p-2">{t("operationalLogs.column.source")}</th>
                  <th role="columnheader" scope="col" className="p-2">{t("operationalLogs.column.severity")}</th>
                  <th role="columnheader" scope="col" className="p-2">{t("operationalLogs.column.message")}</th>
                  <th role="columnheader" scope="col" className="p-2">{t("operationalLogs.column.trace")}</th>
                </tr></thead>
                <tbody role="rowgroup" className="grid gap-3 sm:table-row-group">{entries.map((entry) => <tr role="row" key={entry.id} data-testid="operational-log-row" className="grid gap-2 rounded-xl border p-4 align-top sm:table-row sm:rounded-none sm:border-0 sm:p-0">
                  <td role="cell" className={cell}>
                    <span aria-hidden="true" className={cellLabel}>{t("operationalLogs.column.time")}</span>
                    <span className="min-w-0 sm:whitespace-nowrap">{formatDateTime(entry.occurredAt, language, club.timeZone)}</span>
                  </td>
                  <td role="cell" className={cell}>
                    <span aria-hidden="true" className={cellLabel}>{t("operationalLogs.column.source")}</span>
                    <span data-testid="operational-log-source" className="min-w-0 break-words">{t(`operationalLogs.source.${entry.source}`)}</span>
                  </td>
                  <td role="cell" className={cell}>
                    <span aria-hidden="true" className={cellLabel}>{t("operationalLogs.column.severity")}</span>
                    <span data-testid="operational-log-severity" className="min-w-0 break-words">{t(`operationalLogs.severity.${entry.severity}`)}</span>
                  </td>
                  <td role="cell" className={cell}>
                    <span aria-hidden="true" className={cellLabel}>{t("operationalLogs.column.message")}</span>
                    <span data-testid="operational-log-message" className="min-w-0 [overflow-wrap:anywhere]">{entry.message}</span>
                  </td>
                  <td role="cell" className={cell}>
                    <span aria-hidden="true" className={cellLabel}>{t("operationalLogs.column.trace")}</span>
                    <span data-testid="operational-log-trace" className="min-w-0 font-mono text-sm [overflow-wrap:anywhere] sm:inline-block sm:min-w-[16ch]">{entry.traceId ?? t("operationalLogs.trace.none")}</span>
                  </td>
                </tr>)}</tbody>
              </table></ScrollRegion>}
            {page.nextCursor && <Button variant="secondary" data-testid="operational-logs-load-more" disabled={pending} className="justify-self-start" type="button" onClick={() => void readNextPage()}>{t("operationalLogs.more")}</Button>}
          </>}
      </>}
  </section>;
}
