import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type AccessGrantOverview, type AdminAccessGrant, type AdminAccessGrantStatus } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { useClubConfiguration } from "../club/registry";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { LoadFailure } from "../components/LoadFailure";
import { noticeColours, type AlertTone } from "../components/noticeTones";
import { useRetry } from "../failures/useRetry";
import { formatDateTime } from "../time/clubZone";

const tones: Record<AdminAccessGrantStatus, AlertTone> = {
  FAILING: "error", REMOVING: "warning", INSTALLED: "success", WAITING: "warning", DONE: "success"
};

export function AdminAccessGrantsView() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const { club, error: clubError, load: loadClub } = useClubConfiguration();
  const [overview, setOverview] = useState<AccessGrantOverview>();
  const [error, setError] = useState<string>();
  const [retrying, setRetrying] = useState<string>();
  const [probeRequested, setProbeRequested] = useState(false);
  const [attempt, reload] = useRetry();

  const reportError = useCallback((failure: unknown) => setError(problemMessage(failure, t)), [t]);
  const reportErrorRef = useRef(reportError);
  useEffect(() => { reportErrorRef.current = reportError; }, [reportError]);

  useEffect(() => {
    let active = true;
    void api.adminAccessGrants()
      .then((result) => {
        if (!active) return;
        setOverview(result);
        setError(undefined);
      })
      .catch((failure: unknown) => { if (active) reportErrorRef.current(failure); });
    return () => { active = false; };
  }, [attempt]);

  function time(instant: string | null | undefined): string {
    return instant && club ? formatDateTime(instant, language, club.timeZone) : "";
  }

  async function retryGrant(grant: AdminAccessGrant) {
    setRetrying(grant.id);
    try {
      await api.retryAdminAccessGrant(grant.id);
      setError(undefined);
      reload();
    } catch (failure: unknown) {
      reportError(failure);
    } finally {
      setRetrying(undefined);
    }
  }

  async function requestProbe() {
    try {
      await api.probeAccessControl();
      setError(undefined);
      setProbeRequested(true);
    } catch (failure: unknown) {
      reportError(failure);
    }
  }

  const problem = error ?? clubError;
  const probe = overview?.probe;
  return <section data-testid="admin-access-grants-view" className="surface-panel grid gap-5 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-3xl font-bold">{t("accessGrants.title")}</h1>
        <Button variant="secondary" data-testid="access-grants-refresh" type="button"
          onClick={() => { setProbeRequested(false); reload(); }}>{t("accessGrants.refresh")}</Button>
      </div>
      <p className="text-muted">{t("accessGrants.introduction")}</p>
    </div>
    {!overview || !club
      ? (problem ? <LoadFailure message={problem} retry={() => { setError(undefined); loadClub(); reload(); }} /> : <p role="status">{t("status.loading")}</p>)
      : <>
        {problem && <Alert testId="access-grants-problem">{problem}</Alert>}
        <p data-testid="access-grants-connector" className="font-semibold">
          {overview.connected
            ? t("accessGrants.connected", { connector: overview.connector })
            : t("accessGrants.notConnected")}
        </p>
        {overview.connected && <div className="grid gap-2">
          {probe
            ? <div data-testid="access-grants-probe" data-outcome={probe.outcome}
              className={`grid gap-1 rounded-xl border-2 px-4 py-2 ${noticeColours(probe.reachable ? "success" : "error")}`}>
              <p>{t(`accessGrants.probe.${probe.outcome}`, { time: time(probe.checkedAt) })}</p>
              {probe.detail && <p data-testid="access-grants-probe-detail" className="[overflow-wrap:anywhere]">
                {t("accessGrants.probe.detail", { detail: probe.detail })}
              </p>}
            </div>
            : <p data-testid="access-grants-probe" data-outcome="none" className="text-muted">{t("accessGrants.probe.none")}</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button variant="secondary" data-testid="access-grants-probe-now" type="button"
              onClick={() => void requestProbe()}>{t("accessGrants.probeNow")}</Button>
            {probeRequested && <p role="status" data-testid="access-grants-probe-requested" className="text-muted">
              {t("accessGrants.probeRequested")}
            </p>}
          </div>
        </div>}
        {overview.grants.length === 0
          ? <p data-testid="access-grants-empty" className="text-muted">{t("accessGrants.empty")}</p>
          : <>
            {overview.total > overview.grants.length && <p data-testid="access-grants-more" className="text-muted">
              {t("accessGrants.more", { shown: overview.grants.length, total: overview.total })}
            </p>}
            <ul className="grid gap-2" aria-label={t("accessGrants.title")}>
              {overview.grants.map((grant) => <li key={grant.id} data-testid={`access-grant-${grant.bookingId}`}
                data-status={grant.status} className={`grid gap-1 rounded-xl border-2 px-4 py-3 ${noticeColours(tones[grant.status])}`}>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <h2 className="text-lg font-semibold">
                    {t("accessGrants.booking", {
                      time: time(grant.startsAt),
                      courts: grant.courts.map((court) => court.name).join(", ")
                    })}
                  </h2>
                  <p data-testid="access-grant-status" className="font-semibold">{t(`accessGrants.status.${grant.status}`)}</p>
                </div>
                {grant.validFrom && grant.validUntil && <p data-testid="access-grant-window">
                  {t("accessGrants.window", {
                    from: time(grant.validFrom), until: time(grant.validUntil), accessPoints: grant.accessPoints.join(", ")
                  })}
                </p>}
                {grant.lastFailure && <p data-testid="access-grant-failure" className="[overflow-wrap:anywhere]">
                  {t("accessGrants.lastFailure", { count: grant.attempts, failure: grant.lastFailure })}
                </p>}
                {grant.nextAttemptAt && <p data-testid="access-grant-next-attempt" className="text-muted">
                  {t("accessGrants.nextAttempt", { time: time(grant.nextAttemptAt) })}
                </p>}
                {grant.status === "FAILING" && <div>
                  <Button variant="primary" data-testid="access-grant-retry" type="button" disabled={retrying !== undefined}
                    onClick={() => void retryGrant(grant)}>{t("accessGrants.retry")}</Button>
                </div>}
              </li>)}
            </ul>
          </>}
      </>}
  </section>;
}
