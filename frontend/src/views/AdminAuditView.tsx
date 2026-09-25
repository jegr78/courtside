import type { TFunction } from "i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { api, type AuditEntry, type AuditSearch } from "../api/client";
import { actorLabel, auditMessage, subjectLabel } from "../audit/auditText";
import { problemMessage } from "../api/problem-message";
import { useClubConfiguration } from "../club/registry";
import { formatDateTime, zonedDateTime } from "../time/clubZone";
import { Alert } from "../components/Alert";
import { LoadFailure } from "../components/LoadFailure";
import { useRetry } from "../failures/useRetry";
import { Button } from "../components/Button";

const EVENT_TYPE_LABEL = "audit.eventType.";

function eventTypeChoices(bundle: Record<string, unknown> | undefined, language: string, t: TFunction): { eventType: string; label: string }[] {
  return Object.keys(bundle ?? {})
    .filter((key) => key.startsWith(EVENT_TYPE_LABEL))
    .map((key) => ({ eventType: key.slice(EVENT_TYPE_LABEL.length), label: t(key) }))
    .sort((left, right) => left.label.localeCompare(right.label, language));
}

export function AdminAuditView() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const [search] = useSearchParams();
  const subjectId = search.get("subjectId") ?? undefined;
  const { club, error: clubError, load: loadClub } = useClubConfiguration();
  const [entries, setEntries] = useState<AuditEntry[]>();
  const [cursor, setCursor] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const [eventType, setEventType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [criteria, setCriteria] = useState<AuditSearch>();
  const [searchIncomplete, setSearchIncomplete] = useState(false);
  const [loadAttempt, retryLoad] = useRetry();

  const reportError = useCallback((failure: unknown) => setError(problemMessage(failure, t)), [t]);
  const reportErrorRef = useRef(reportError);
  useEffect(() => {
    reportErrorRef.current = reportError;
  }, [reportError]);

  useEffect(() => {
    void api.audit(undefined, 50, subjectId)
      .then((page) => {
        setEntries(page.entries);
        setCursor(page.nextCursor ?? undefined);
        setSearchIncomplete(page.searchIncomplete ?? false);
      })
      .catch((failure: unknown) => reportErrorRef.current(failure));
  }, [loadAttempt, subjectId]);

  async function readNextPage() {
    if (pending) return;
    setPending(true);
    try {
      const page = criteria
        ? await api.searchAudit({ ...criteria, cursor, limit: 50 })
        : await api.audit(cursor, 50, subjectId);
      setEntries((current) => [...(current ?? []), ...page.entries]);
      setCursor(page.nextCursor ?? undefined);
      setSearchIncomplete(page.searchIncomplete ?? false);
      setError(undefined);
    } catch (failure) {
      reportError(failure);
    } finally {
      setPending(false);
    }
  }

  async function applyFilters(next: AuditSearch | undefined) {
    if (pending) return;
    setPending(true);
    try {
      const page = next ? await api.searchAudit({ ...next, limit: 50 }) : await api.audit(undefined, 50, subjectId);
      setCriteria(next);
      setEntries(page.entries);
      setCursor(page.nextCursor ?? undefined);
      setSearchIncomplete(page.searchIncomplete ?? false);
      setError(undefined);
    } catch (failure) {
      reportError(failure);
    } finally {
      setPending(false);
    }
  }

  function submittedCriteria(): AuditSearch {
    const instant = (value: string) => zonedDateTime(value.slice(0, 10), value.slice(11), club!.timeZone);
    return {
      ...(query.trim() ? { query: query.trim() } : {}),
      ...(eventType ? { eventType } : {}),
      ...(subjectId ? { subjectId } : {}),
      ...(from ? { from: instant(from) } : {}),
      ...(to ? { to: instant(to) } : {})
    };
  }

  const problem = error ?? clubError;
  return <section data-testid="admin-audit-view" className="surface-panel grid gap-8 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <h1 className="text-3xl font-bold">{t("audit.title")}</h1>
    {!entries || !club
      ? (problem ? <LoadFailure message={problem} retry={() => { setError(undefined); loadClub(); retryLoad(); }} /> : <p role="status">{t("status.loading")}</p>)
      : <>
        {problem && <Alert>{problem}</Alert>}
        {searchIncomplete && <Alert tone="warning" testId="audit-search-incomplete">{t("audit.filter.incomplete")}</Alert>}
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" onSubmit={(event) => {
          event.preventDefault();
          try {
            void applyFilters(submittedCriteria());
          } catch (failure) {
            reportError(failure);
          }
        }}>
          <label className="grid gap-1 font-medium">{t("audit.filter.query")}
            <input data-testid="audit-filter-query" className="form-control rounded-lg border px-3 py-2" value={query} maxLength={60} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <label className="grid min-w-0 gap-1 font-medium">{t("audit.filter.eventType")}
            <select data-testid="audit-filter-event-type" className="form-control w-full min-w-0 rounded-lg border px-3 py-2" value={eventType} onChange={(event) => setEventType(event.target.value)}>
              <option value="">{t("audit.filter.anyEventType")}</option>
              {eventTypeChoices(i18n.getResourceBundle(language, "translation") as Record<string, unknown> | undefined, language, t).map((choice) => <option key={choice.eventType} value={choice.eventType}>{choice.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 font-medium">{t("audit.filter.from")}
            <input data-testid="audit-filter-from" type="datetime-local" className="form-control rounded-lg border px-3 py-2" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label className="grid gap-1 font-medium">{t("audit.filter.to")}
            <input data-testid="audit-filter-to" type="datetime-local" className="form-control rounded-lg border px-3 py-2" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          <div className="flex flex-wrap gap-3 md:col-span-2 xl:col-span-4">
            <Button data-testid="audit-filter-apply" variant="primary" type="submit" disabled={pending}>{t("audit.filter.apply")}</Button>
            <Button data-testid="audit-filter-clear" variant="secondary" type="button" disabled={pending} onClick={() => {
              setQuery(""); setEventType(""); setFrom(""); setTo("");
              void applyFilters(undefined);
            }}>{t("audit.filter.clear")}</Button>
          </div>
        </form>
        {entries.length === 0
          ? <p data-testid="audit-empty">{t("audit.empty")}</p>
          : <div>
            <table className="block w-full text-left sm:table">
              <thead className="sr-only sm:not-sr-only">
                <tr>
                  <th scope="col" className="p-2">{t("audit.column.occurredAt")}</th>
                  <th scope="col" className="p-2">{t("audit.column.change")}</th>
                  <th scope="col" className="p-2">{t("audit.column.subject")}</th>
                  <th scope="col" className="p-2">{t("audit.column.actor")}</th>
                </tr>
              </thead>
              <tbody className="grid gap-3 sm:table-row-group">
                {entries.map((entry) => <tr key={entry.id} data-testid="audit-row" data-entry-id={entry.id} data-subject-id={entry.subjectId} data-event-type={entry.eventType} className="grid gap-2 rounded-xl border p-4 sm:table-row sm:rounded-none sm:border-0 sm:p-0">
                  <td className="grid min-w-0 grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3 sm:table-cell sm:border-t sm:p-2">
                    <span aria-hidden="true" data-testid="audit-label-occurred-at" className="font-medium sm:hidden">{t("audit.column.occurredAt")}</span>
                    <span data-testid="audit-occurred-at" className="min-w-0 break-words">{formatDateTime(entry.occurredAt, language, club.timeZone)}</span>
                  </td>
                  <td className="grid min-w-0 grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3 sm:table-cell sm:border-t sm:p-2">
                    <span aria-hidden="true" data-testid="audit-label-change" className="font-medium sm:hidden">{t("audit.column.change")}</span>
                    <span data-testid="audit-message" className="min-w-0 [overflow-wrap:anywhere]">{auditMessage(entry, t)}</span>
                  </td>
                  <td className="grid min-w-0 grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3 sm:table-cell sm:border-t sm:p-2">
                    <span aria-hidden="true" data-testid="audit-label-subject" className="font-medium sm:hidden">{t("audit.column.subject")}</span>
                    <span data-testid="audit-subject" className="min-w-0 [overflow-wrap:anywhere]">{subjectLabel(entry, t)}</span>
                  </td>
                  <td className="grid min-w-0 grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3 sm:table-cell sm:border-t sm:p-2">
                    <span aria-hidden="true" data-testid="audit-label-actor" className="font-medium sm:hidden">{t("audit.column.actor")}</span>
                    <span data-testid="audit-actor" className="min-w-0 [overflow-wrap:anywhere]">{actorLabel(entry, t)}</span>
                  </td>
                </tr>)}
              </tbody>
            </table>
          </div>}
        {cursor && <Button variant="secondary" data-testid="audit-load-more" disabled={pending} className="justify-self-start" type="button" onClick={() => void readNextPage()}>{t("audit.more")}</Button>}
      </>}
  </section>;
}
