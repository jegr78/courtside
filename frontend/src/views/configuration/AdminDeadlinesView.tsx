import { LoadingStatus } from "../../components/LoadingGroup";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type ClubConfig } from "../../api/client";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { LoadFailure } from "../../components/LoadFailure";
import { Modal } from "../../components/Modal";
import { SuccessFeedback } from "../../components/SuccessFeedback";
import { TextField } from "../../components/TextField";
import { useReportedFailure } from "../../failures/useReportedFailure";
import { useRetry } from "../../failures/useRetry";
import { SaveBar } from "../../unsaved/SaveBar";
import { AttendancePolicySection } from "./AttendancePolicySection";
import { ownedFields, useClubConfigForm } from "./clubConfigForm";

export function AdminDeadlinesView({ configurationChanged }: { configurationChanged: (config: ClubConfig) => void }) {
  const { t } = useTranslation();
  const { message: error, report, clear } = useReportedFailure();
  const { config, saved, unsaved, loaded, applied, change, discard, save: send } = useClubConfigForm(configurationChanged, ownedFields.deadlines);
  const [pending, setPending] = useState(false);
  const [confirmingDeletion, setConfirmingDeletion] = useState(false);
  const [success, setSuccess] = useState<string>();
  const [loadAttempt, retryLoad] = useRetry();

  useEffect(() => {
    let active = true;
    void api.adminConfig()
      .then((read) => {
        if (active) loaded(read);
      })
      .catch((failure) => {
        if (active) report(failure);
      });
    return () => {
      active = false;
    };
  }, [loadAttempt, loaded, report]);

  function save(event: FormEvent) {
    event.preventDefault();
    if (!config || pending) return;
    const shortened = saved?.readNotificationDays !== undefined && config.readNotificationDays !== undefined
      && config.readNotificationDays < saved.readNotificationDays;
    if (shortened) setConfirmingDeletion(true);
    else void persist();
  }

  async function persist() {
    if (!config) return;
    setConfirmingDeletion(false);
    setPending(true);
    clear();
    setSuccess(undefined);
    try {
      applied(await send(config));
      setSuccess(t("admin.deadlines.saved"));
    } catch (failure) {
      report(failure);
    } finally {
      setPending(false);
    }
  }

  return <section data-testid="admin-deadlines-view" className="surface-panel min-w-0 grid gap-8 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] [&>*]:min-w-0 [&>*]:max-w-5xl sm:p-8">
    <h1 className="text-3xl font-bold">{t("admin.deadlines.title")}</h1>
    {!config
      ? (error ? <LoadFailure message={error} retry={() => { clear(); retryLoad(); }} /> : <LoadingStatus />)
      : <>
        {error && <Alert testId="admin-error">{error}</Alert>}
        {success && <SuccessFeedback testId="admin-save-success">{success}</SuccessFeedback>}
        <form id="deadlines-form" noValidate onSubmit={save} className="grid gap-5">
          <div data-testid="deadline-fields" className="grid gap-5 [&>*]:min-w-0 md:grid-cols-2 md:items-start">
            <TextField data-testid="new-account-credential-hours" type="number" min={1} max={168} className="max-w-32" label={t("admin.config.newAccountCredentialHours")} value={config.newAccountCredentialHours} onChange={(event) => change({ newAccountCredentialHours: Number(event.target.value) })} />
            <TextField data-testid="password-reset-credential-hours" type="number" min={1} max={168} className="max-w-32" label={t("admin.config.passwordResetCredentialHours")} value={config.passwordResetCredentialHours} onChange={(event) => change({ passwordResetCredentialHours: Number(event.target.value) })} />
            <div className="grid gap-1">
              <TextField data-testid="password-reset-token-minutes" type="number" min={15} max={1440} className="max-w-32" label={t("admin.config.passwordResetTokenMinutes")} value={config.passwordResetTokenMinutes} onChange={(event) => change({ passwordResetTokenMinutes: Number(event.target.value) })} />
              <p className="text-muted text-sm">{t("admin.config.passwordResetTokenMinutesHelp")}</p>
            </div>
            <div className="grid gap-1">
              <TextField data-testid="booking-reminder-hours" type="number" min={0} max={168} className="max-w-32" label={t("admin.config.bookingReminderHours")} value={config.bookingReminderHours} onChange={(event) => change({ bookingReminderHours: Number(event.target.value) })} />
              <p className="text-muted text-sm">{t("admin.config.bookingReminderHoursHelp")}</p>
            </div>
            <div className="grid gap-1">
              <TextField data-testid="waitlist-offer-minutes" type="number" min={1} max={1440} className="max-w-32" label={t("admin.config.waitlistOfferMinutes")} value={config.waitlistOfferMinutes ?? 15} onChange={(event) => change({ waitlistOfferMinutes: Number(event.target.value) })} />
              <p className="text-muted text-sm">{t("admin.config.waitlistOfferMinutesHelp")}</p>
            </div>
            <div className="grid gap-1">
              <TextField data-testid="read-notification-days" type="number" min={1} max={3650} className="max-w-32" label={t("admin.config.readNotificationDays")} value={config.readNotificationDays ?? 90} onChange={(event) => change({ readNotificationDays: Number(event.target.value) })} />
              <p className="text-muted text-sm">{t("admin.config.readNotificationDaysHelp")}</p>
            </div>
          </div>
          <SaveBar id="deadlines" subject={t("admin.deadlines.title")} saveTestId="save-deadlines" form="deadlines-form"
                   unsaved={unsaved} pending={pending} discard={discard} />
        </form>
        {confirmingDeletion && <Modal labelledBy="read-notification-days-confirm-title" closed={() => setConfirmingDeletion(false)}>
          <div className="grid gap-4">
            <h2 id="read-notification-days-confirm-title" className="text-2xl font-bold">{t("admin.deadlines.shortenTitle")}</h2>
            <p data-testid="read-notification-days-confirm-text">{t("admin.deadlines.shortenConfirm", { days: config.readNotificationDays })}</p>
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" data-testid="read-notification-days-confirm" type="button"
                onClick={() => void persist()}>{t("admin.deadlines.shortenAction")}</Button>
              <Button variant="secondary" data-testid="read-notification-days-cancel" type="button"
                onClick={() => setConfirmingDeletion(false)}>{t("admin.deadlines.shortenCancel")}</Button>
            </div>
          </div>
        </Modal>}
        <AttendancePolicySection />
      </>}
  </section>;
}
