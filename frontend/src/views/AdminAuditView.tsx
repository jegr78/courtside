import type { TFunction } from "i18next";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, type AuditEntry } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";

const enabledFlagByEventType: Record<string, string> = {
  "roster.account.availabilityChanged": "enabled"
};

function auditMessage(entry: AuditEntry, t: TFunction): string {
  const flagKey = enabledFlagByEventType[entry.eventType] ?? "active";
  const context = entry.eventType.endsWith(".availabilityChanged")
    ? (entry.parameters[flagKey] ? "active" : "inactive")
    : undefined;
  return t(`audit.event.${entry.eventType}`, { ...entry.parameters, ...(context ? { context } : {}) });
}

function actorLabel(entry: AuditEntry, t: TFunction): string {
  if (!entry.actorAccountId) return t("audit.actor.system");
  return entry.actorUsername ?? entry.actorAccountId;
}

function subjectLabel(entry: AuditEntry): string {
  return entry.subjectName ?? entry.subjectId ?? "";
}

export function AdminAuditView() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<AuditEntry[]>();
  const [cursor, setCursor] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const reportError = useCallback((failure: unknown) => setError(problemMessage(failure, t)), [t]);

  useEffect(() => {
    void api.audit()
      .then((page) => {
        setEntries(page.entries);
        setCursor(page.nextCursor ?? undefined);
      })
      .catch(reportError);
  }, [reportError]);

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
            {entries.map((entry) => <tr key={entry.id} data-testid="audit-row" data-entry-id={entry.id} data-subject-id={entry.subjectId ?? ""} className="border-t">
              <td className="p-2">{new Date(entry.occurredAt).toLocaleString()}</td>
              <td data-testid="audit-message" className="p-2">{auditMessage(entry, t)}</td>
              <td data-testid="audit-subject" className="p-2">{subjectLabel(entry)}</td>
              <td data-testid="audit-actor" className="p-2">{actorLabel(entry, t)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>}
    {cursor && <Button data-testid="audit-load-more" disabled={pending} className="justify-self-start" type="button" onClick={() => void readNextPage()}>{t("audit.more")}</Button>}
  </section>;
}
