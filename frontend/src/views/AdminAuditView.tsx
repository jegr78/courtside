import type { TFunction } from "i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, type AuditEntry } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { formatDateTime, shortTime } from "../time/clubZone";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";

const enabledFlagByEventType: Record<string, string> = {
  "roster.account.availabilityChanged": "enabled"
};

const isoWeekdayNames = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

function paramsLabel(params: Record<string, unknown>, t: TFunction): string {
  return Object.entries(params)
    .map(([name, value]) => `${t(`admin.rules.parameter.${name}`)}: ${String(value)}`)
    .join(", ");
}

function weekdayLabel(entry: AuditEntry, t: TFunction): string | undefined {
  const dayOfWeek = entry.parameters.dayOfWeek;
  return typeof dayOfWeek === "number" ? t(`weekday.${isoWeekdayNames[dayOfWeek - 1]}`) : undefined;
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined;
}

function contextFor(entry: AuditEntry): string | undefined {
  if (entry.eventType.endsWith(".availabilityChanged")) {
    const flagKey = enabledFlagByEventType[entry.eventType] ?? "active";
    return entry.parameters[flagKey] ? "active" : "inactive";
  }
  if (entry.eventType === "card.participantCard.added" && isNullish(entry.parameters.capacity)) {
    return "unlimited";
  }
  if (entry.eventType === "roster.membership.written" && isNullish(entry.parameters.startedOn)) {
    return "unknownStart";
  }
  return undefined;
}

function auditMessage(entry: AuditEntry, t: TFunction): string {
  const context = contextFor(entry);
  const weekday = weekdayLabel(entry, t);
  const ruleType = typeof entry.parameters.ruleType === "string"
    ? t(`admin.rules.type.${entry.parameters.ruleType}`)
    : undefined;
  const params = typeof entry.parameters.params === "object" && entry.parameters.params !== null
    ? paramsLabel(entry.parameters.params as Record<string, unknown>, t)
    : undefined;
  const opensAt = typeof entry.parameters.opensAt === "string" ? shortTime(entry.parameters.opensAt) : undefined;
  const closesAt = typeof entry.parameters.closesAt === "string" ? shortTime(entry.parameters.closesAt) : undefined;
  return t(`audit.event.${entry.eventType}`, {
    ...entry.parameters,
    ...(weekday !== undefined ? { weekday } : {}),
    ...(ruleType !== undefined ? { ruleType } : {}),
    ...(params !== undefined ? { params } : {}),
    ...(opensAt !== undefined ? { opensAt } : {}),
    ...(closesAt !== undefined ? { closesAt } : {}),
    ...(context ? { context } : {})
  });
}

function actorLabel(entry: AuditEntry, t: TFunction): string {
  if (!entry.actorAccountId) return t("audit.actor.system");
  return entry.actorUsername ?? entry.actorAccountId;
}

function subjectLabel(entry: AuditEntry, t: TFunction): string {
  return entry.subjectName ?? weekdayLabel(entry, t) ?? entry.subjectId;
}

export function AdminAuditView() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const [entries, setEntries] = useState<AuditEntry[]>();
  const [cursor, setCursor] = useState<string>();
  const [timeZone, setTimeZone] = useState("UTC");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const reportError = useCallback((failure: unknown) => setError(problemMessage(failure, t)), [t]);
  const reportErrorRef = useRef(reportError);
  useEffect(() => {
    reportErrorRef.current = reportError;
  }, [reportError]);

  useEffect(() => {
    void Promise.all([api.audit(), api.config()])
      .then(([page, config]) => {
        setEntries(page.entries);
        setCursor(page.nextCursor ?? undefined);
        setTimeZone(config.timeZone);
      })
      .catch((failure: unknown) => reportErrorRef.current(failure));
  }, []);

  async function readNextPage() {
    if (pending) return;
    setPending(true);
    try {
      const page = await api.audit(cursor);
      setEntries((current) => [...(current ?? []), ...page.entries]);
      setCursor(page.nextCursor ?? undefined);
      setError(undefined);
    } catch (failure) {
      reportError(failure);
    } finally {
      setPending(false);
    }
  }

  if (error && !entries) return <Alert>{error}</Alert>;
  if (!entries) return <p role="status">{t("status.loading")}</p>;

  return <section data-testid="admin-audit-view" className="surface-panel grid w-full max-w-7xl gap-8 self-start rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-3xl font-bold">{t("audit.title")}</h1>
      <Link to="/" className="font-semibold underline">{t("nav.courts")}</Link>
    </div>
    {error && <Alert>{error}</Alert>}
    {entries.length === 0
      ? <p data-testid="audit-empty">{t("audit.empty")}</p>
      : <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr>
              <th scope="col" className="p-2">{t("audit.column.occurredAt")}</th>
              <th scope="col" className="p-2">{t("audit.column.change")}</th>
              <th scope="col" className="p-2">{t("audit.column.subject")}</th>
              <th scope="col" className="p-2">{t("audit.column.actor")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => <tr key={entry.id} data-testid="audit-row" data-entry-id={entry.id} data-subject-id={entry.subjectId} data-event-type={entry.eventType} className="border-t">
              <td data-testid="audit-occurred-at" className="p-2">{formatDateTime(entry.occurredAt, language, timeZone)}</td>
              <td data-testid="audit-message" className="p-2">{auditMessage(entry, t)}</td>
              <td data-testid="audit-subject" className="p-2">{subjectLabel(entry, t)}</td>
              <td data-testid="audit-actor" className="p-2">{actorLabel(entry, t)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>}
    {cursor && <Button data-testid="audit-load-more" disabled={pending} className="justify-self-start" type="button" onClick={() => void readNextPage()}>{t("audit.more")}</Button>}
  </section>;
}
