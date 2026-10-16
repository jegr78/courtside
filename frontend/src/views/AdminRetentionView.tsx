import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  api, ApiError, type RetentionCategory, type RetentionPolicy, type RetentionPreview, type RetentionRun
} from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { LoadFailure } from "../components/LoadFailure";
import { Modal } from "../components/Modal";
import { SuccessFeedback } from "../components/SuccessFeedback";
import { TextField } from "../components/TextField";
import { useClubConfiguration } from "../club/registry";
import { useRetry } from "../failures/useRetry";
import { parseDate } from "../time/clubZone";
import { dateTimeFormatter } from "../time/dateTimeFormatter";

const CATEGORIES: RetentionCategory[] = ["BOOKINGS", "FORMER_MEMBERS"];
const RECENT_AUTH = "urn:courtside:error:recent-authentication-required";
const USED_UP = ["urn:courtside:error:retention-preview-not-found", "urn:courtside:error:retention-preview-expired"];
const RUN_FIGURES = [
  "bookingsPseudonymised", "seriesPseudonymised", "formerMembersRemoved", "accountsRemoved", "formerMembersSkipped"
] as const;

export function AdminRetentionView() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const { club } = useClubConfiguration();
  const [policies, setPolicies] = useState<RetentionPolicy[]>();
  const [drafts, setDrafts] = useState<Partial<Record<RetentionCategory, string>>>({});
  const [preview, setPreview] = useState<RetentionPreview>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [run, setRun] = useState<RetentionRun>();
  const [error, setError] = useState<string>();
  const [loadFailure, setLoadFailure] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [retry, setRetry] = useState<RetentionPreview>();
  const [reauthenticationFailure, setReauthenticationFailure] = useState<string>();
  const [pending, setPending] = useState(false);
  const [loadAttempt, retryLoad] = useRetry();

  useEffect(() => {
    let active = true;
    void api.retentionPolicies()
      .then((read) => {
        if (active) setPolicies(read);
      })
      .catch((failure: unknown) => {
        if (active) setLoadFailure(problemMessage(failure, t));
      });
    return () => {
      active = false;
    };
  }, [loadAttempt, t]);

  const monthsOf = (category: RetentionCategory) =>
    policies?.find((policy) => policy.category === category)?.retainMonths;
  const configured = CATEGORIES.some((category) => monthsOf(category) !== undefined);
  const instantDay = (instant: string) =>
    dateTimeFormatter(language, { dateStyle: "medium", timeZone: club?.timeZone }).format(new Date(instant));
  const calendarDay = (date: string) => dateTimeFormatter(language, { dateStyle: "medium" }).format(parseDate(date));

  function changed(next: RetentionPolicy[], message: string) {
    setPolicies(next);
    setPreview(undefined);
    setAcknowledged(false);
    setSuccess(message);
  }

  async function attempt(action: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      await action();
    } catch (failure) {
      if (failure instanceof ApiError && failure.problem?.type && USED_UP.includes(failure.problem.type)) {
        setPreview(undefined);
        setAcknowledged(false);
      }
      setError(problemMessage(failure, t));
    } finally {
      setPending(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>, category: RetentionCategory) {
    event.preventDefault();
    const months = Number(drafts[category] ?? monthsOf(category));
    void attempt(async () => {
      await api.setRetentionPolicy(category, months);
      setDrafts((current) => ({ ...current, [category]: undefined }));
      changed(await api.retentionPolicies(), t("admin.retention.saved", { category: t(`admin.retention.category.${category}`) }));
    });
  }

  function remove(category: RetentionCategory) {
    void attempt(async () => {
      await api.removeRetentionPolicy(category);
      setDrafts((current) => ({ ...current, [category]: undefined }));
      changed(await api.retentionPolicies(), t("admin.retention.removed", { category: t(`admin.retention.category.${category}`) }));
    });
  }

  function takePreview() {
    void attempt(async () => {
      setRun(undefined);
      setAcknowledged(false);
      setPreview(await api.previewRetention());
    });
  }

  async function apply(reviewed: RetentionPreview) {
    try {
      setRun(await api.runRetention(reviewed.previewId));
      setPreview(undefined);
      setAcknowledged(false);
    } catch (failure) {
      if (failure instanceof ApiError && failure.problem?.type === RECENT_AUTH) {
        setRetry(reviewed);
        return;
      }
      throw failure;
    }
  }

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reviewed = preview;
    if (!reviewed || !acknowledged) return;
    void attempt(() => apply(reviewed));
  }

  async function reauthenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("retention-reauthentication-password");
    const reviewed = retry;
    if (typeof password !== "string" || !reviewed || pending) return;
    setPending(true);
    setReauthenticationFailure(undefined);
    try {
      await api.reauthenticate(password);
    } catch (failure) {
      setReauthenticationFailure(problemMessage(failure, t));
      setPending(false);
      return;
    }
    setRetry(undefined);
    setPending(false);
    await attempt(() => apply(reviewed));
  }

  return <section data-testid="admin-retention-view" className="surface-panel grid min-w-0 gap-6 rounded-2xl border p-4 shadow-[0_20px_50px_var(--cs-shadow)] [&>*]:min-w-0 [&>*]:max-w-5xl sm:p-8">
    <div className="grid gap-2">
      <h1 className="text-3xl font-bold">{t("admin.retention.title")}</h1>
      <p className="text-muted">{t("admin.retention.explain")}</p>
    </div>
    {!policies
      ? (loadFailure ? <LoadFailure message={loadFailure} retry={() => { setLoadFailure(undefined); retryLoad(); }} />
        : <p role="status">{t("status.loading")}</p>)
      : <>
        {error && <Alert testId="retention-error">{error}</Alert>}
        {success && <SuccessFeedback testId="retention-success">{success}</SuccessFeedback>}
        <div className="grid gap-4 lg:grid-cols-2">
          {CATEGORIES.map((category) => {
            const months = monthsOf(category);
            return <form key={category} data-testid={`retention-policy-${category}`} noValidate onSubmit={(event) => save(event, category)}
              className="grid content-start gap-3 rounded-xl border p-4">
              <h2 className="text-xl font-semibold">{t(`admin.retention.category.${category}`)}</h2>
              <p className="text-muted text-sm">{t(`admin.retention.categoryExplain.${category}`)}</p>
              <p data-testid={`retention-state-${category}`} data-configured={months === undefined ? "false" : "true"} className="font-medium">
                {months === undefined ? t("admin.retention.notSet") : t("admin.retention.kept", { count: months })}
              </p>
              <TextField data-testid={`retention-months-${category}`} name="retainMonths" type="number" inputMode="numeric"
                min={1} max={1200} step={1} required disabled={pending} label={t("admin.retention.months")}
                value={drafts[category] ?? (months === undefined ? "" : String(months))}
                onChange={(event) => setDrafts((current) => ({ ...current, [category]: event.target.value }))} />
              <div className="flex flex-wrap gap-3">
                <Button data-testid={`retention-save-${category}`} variant="primary" disabled={pending} type="submit">{t("admin.retention.save")}</Button>
                <Button data-testid={`retention-remove-${category}`} variant="secondary" disabled={pending || months === undefined} type="button"
                  onClick={() => remove(category)}>{t("admin.retention.remove")}</Button>
              </div>
            </form>;
          })}
        </div>
        <div className="grid gap-3 rounded-xl border p-4">
          <h2 className="text-xl font-semibold">{t("admin.retention.previewHeading")}</h2>
          <p className="text-muted text-sm">{t(configured ? "admin.retention.previewExplain" : "admin.retention.nothingConfigured")}</p>
          <Button data-testid="retention-preview" variant="secondary" disabled={pending || !configured} type="button" className="justify-self-start"
            onClick={takePreview}>{t("admin.retention.preview")}</Button>
          {preview && <div data-testid="retention-preview-result" className="grid gap-3">
            <ul className="grid gap-1">
              {preview.bookings && <li data-testid="retention-preview-bookings">
                {t("admin.retention.previewBookings", {
                  bookings: preview.bookings.bookings, series: preview.bookings.series,
                  before: instantDay(preview.bookings.endedBefore)
                })}
              </li>}
              {preview.formerMembers && <li data-testid="retention-preview-former-members">
                {t("admin.retention.previewFormerMembers", {
                  people: preview.formerMembers.people, accounts: preview.formerMembers.accounts,
                  before: calendarDay(preview.formerMembers.membershipEndedBefore)
                })}
              </li>}
            </ul>
            <div className="grid gap-1">
              <h3 className="font-semibold">{t("admin.retention.blockedHeading")}</h3>
              {preview.blocked.length === 0
                ? <p data-testid="retention-blocked-none">{t("admin.retention.blockedNone")}</p>
                : <ul data-testid="retention-blocked" className="grid gap-1">
                  {preview.blocked.map((record) => <li key={`${record.personId}-${record.reason}`} data-testid="retention-blocked-row"
                    data-reason={record.reason} className="flex flex-wrap gap-x-2">
                    <Link className="focus-ring underline" to={`/admin/roster/${encodeURIComponent(record.personId)}`}>{t("admin.retention.blockedPerson")}</Link>
                    <span>{t(`admin.retention.reason.${record.reason}`)}</span>
                  </li>)}
                </ul>}
            </div>
            <form data-testid="retention-run-form" onSubmit={confirm} className="grid gap-3 border-t pt-3">
              <label className="flex items-start gap-3 font-medium">
                <input data-testid="retention-acknowledge" type="checkbox" className="mt-1 size-5" checked={acknowledged}
                  disabled={pending} onChange={(event) => setAcknowledged(event.target.checked)} />
                {t("admin.retention.acknowledge")}
              </label>
              <p className="text-muted text-sm">{t("admin.retention.expires", {
                at: dateTimeFormatter(language, { timeStyle: "short", timeZone: club?.timeZone }).format(new Date(preview.expiresAt))
              })}</p>
              <Button data-testid="retention-run" variant="destructive-confirm" disabled={pending || !acknowledged} type="submit"
                className="justify-self-start">{t("admin.retention.run")}</Button>
            </form>
          </div>}
          {run && <SuccessFeedback testId="retention-run-result"><div className="grid gap-1">
            <p className="font-semibold">{t("admin.retention.runDone")}</p>
            {RUN_FIGURES.map((figure) => <p key={figure} data-testid={`retention-run-${figure}`}>
              {t(`admin.retention.runFigure.${figure}`, { count: run[figure] })}
            </p>)}
          </div></SuccessFeedback>}
        </div>
      </>}
    {retry && <Modal labelledBy="retention-reauthentication-title" closed={() => {
      setRetry(undefined);
      setReauthenticationFailure(undefined);
    }}>
      <form className="grid gap-4" onSubmit={(event) => void reauthenticate(event)}>
        <h2 id="retention-reauthentication-title" className="text-2xl font-bold">{t("accountSecurity.reauthenticateTitle")}</h2>
        <p>{t("accountSecurity.reauthenticate")}</p>
        {reauthenticationFailure && <Alert testId="retention-reauthentication-failure">{reauthenticationFailure}</Alert>}
        <TextField data-testid="retention-reauthentication-password" id="retention-reauthentication-password" name="retention-reauthentication-password"
          type="password" autoComplete="current-password" required label={t("auth.password")} />
        <Button data-testid="retention-reauthentication-submit" variant="primary" disabled={pending} type="submit">{t("accountSecurity.continue")}</Button>
      </form>
    </Modal>}
  </section>;
}
