import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type OperatorCheckReason, type OperatorCheckState, type OperatorHealth } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { useClubConfiguration } from "../club/registry";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { LoadFailure } from "../components/LoadFailure";
import { noticeColours, type AlertTone } from "../components/noticeTones";
import { useRetry } from "../failures/useRetry";
import { formatDateTime } from "../time/clubZone";

type Check = "version" | "migrations" | "mail" | "publicOrigin" | "backup";

const checks: Check[] = ["version", "migrations", "mail", "publicOrigin", "backup"];

const tones: Record<OperatorCheckState, AlertTone> = { OK: "success", FAILING: "error", UNAVAILABLE: "warning" };

const symbols: Record<OperatorCheckState, string> = { OK: "✓", FAILING: "✕", UNAVAILABLE: "?" };

interface Reading {
  state: OperatorCheckState;
  reason: OperatorCheckReason | null;
  detail: Record<string, string | number>;
}

export function AdminOperatorHealthView() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const { club, error: clubError, load: loadClub } = useClubConfiguration();
  const [health, setHealth] = useState<OperatorHealth>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [attempt, retry] = useRetry();

  const reportError = useCallback((failure: unknown) => setError(problemMessage(failure, t)), [t]);
  const reportErrorRef = useRef(reportError);
  useEffect(() => { reportErrorRef.current = reportError; }, [reportError]);

  useEffect(() => {
    let active = true;
    setPending(true);
    void api.operatorHealth()
      .then((result) => {
        if (!active) return;
        setHealth(result);
        setError(undefined);
      })
      .catch((failure: unknown) => { if (active) reportErrorRef.current(failure); })
      .finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [attempt]);

  function time(instant: string | null | undefined): string {
    return instant && club ? formatDateTime(instant, language, club.timeZone) : "";
  }

  function age(seconds: number): string {
    if (seconds < 3_600) return t("operatorHealth.age.minutes", { count: Math.floor(seconds / 60) });
    if (seconds < 172_800) return t("operatorHealth.age.hours", { count: Math.floor(seconds / 3_600) });
    return t("operatorHealth.age.days", { count: Math.floor(seconds / 86_400) });
  }

  function reading(overview: OperatorHealth, check: Check): Reading {
    switch (check) {
      case "version": {
        const { state, version, revision, builtAt } = overview.version;
        return { state, reason: null, detail: { version, revision: revision ?? t("operatorHealth.version.noRevision"), builtAt: time(builtAt) || t("operatorHealth.version.noBuildTime") } };
      }
      case "migrations": {
        const { state, reason, currentVersion, pending: count, location } = overview.migrations;
        return { state, reason, detail: { version: currentVersion ?? "", count, location: location ?? "" } };
      }
      case "mail": {
        const { state, reason, lastHandedOverAt, location } = overview.mail;
        return { state, reason, detail: { time: time(lastHandedOverAt), location: location ?? "" } };
      }
      case "publicOrigin": {
        const { state, reason, origin } = overview.publicOrigin;
        return { state, reason, detail: { origin: origin ?? "" } };
      }
      case "backup": {
        const { state, reason, completedAt, ageSeconds, location } = overview.backup;
        return { state, reason, detail: { time: time(completedAt), age: ageSeconds === undefined || ageSeconds === null ? "" : age(ageSeconds), location: location ?? "" } };
      }
    }
  }

  const problem = error ?? clubError;
  return <section data-testid="admin-operator-health-view" className="surface-panel grid gap-5 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-3xl font-bold">{t("operatorHealth.title")}</h1>
        <div className="flex flex-wrap items-center gap-3">
          {health && club && <p data-testid="operator-health-checked-at" className="text-muted text-sm">{t("operatorHealth.checkedAt", { time: time(health.checkedAt) })}</p>}
          <Button variant="secondary" data-testid="operator-health-refresh" type="button" disabled={pending} onClick={retry}>{t("operatorHealth.refresh")}</Button>
        </div>
      </div>
      <p className="text-muted">
        {t("operatorHealth.introduction")}{" "}
        <strong data-testid="operator-health-unavailable-meaning" className="font-semibold">{t("operatorHealth.unavailableMeaning")}</strong>
      </p>
    </div>
    {!health || !club
      ? (problem ? <LoadFailure message={problem} retry={() => { setError(undefined); loadClub(); retry(); }} /> : <p role="status">{t("status.loading")}</p>)
      : <>
        {problem && <Alert testId="operator-health-problem">{problem}</Alert>}
        <ul className="grid gap-2" aria-label={t("operatorHealth.title")}>
          {checks.map((check) => {
            const { state, reason, detail } = reading(health, check);
            const detailKey = state === "OK" ? `operatorHealth.${check}.ok` : `operatorHealth.${check}.${reason ?? "unknown"}`;
            return <li key={check} data-testid={`operator-check-${check}`} data-state={state} className={`grid gap-1 rounded-xl border-2 px-4 py-3 ${state === "UNAVAILABLE" ? "border-dashed" : ""} ${noticeColours(tones[state])}`}>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <h2 className="text-lg font-semibold">{t(`operatorHealth.check.${check}`)}</h2>
                <p data-testid={`operator-check-${check}-state`} className="flex items-center gap-2 font-semibold">
                  <span aria-hidden="true" className="inline-grid size-6 place-items-center rounded-full border-2 border-current text-sm leading-none">{symbols[state]}</span>
                  {t(`operatorHealth.state.${state}`)}
                </p>
              </div>
              <p className="min-w-0 [overflow-wrap:anywhere]">
                <span data-testid={`operator-check-${check}-detail`}>{t(detailKey, detail)}</span>
                {state === "UNAVAILABLE" && <>{" "}<strong data-testid={`operator-check-${check}-not-healthy`} className="font-semibold">{t("operatorHealth.unavailableHint")}</strong></>}
              </p>
            </li>;
          })}
        </ul>
      </>}
  </section>;
}
