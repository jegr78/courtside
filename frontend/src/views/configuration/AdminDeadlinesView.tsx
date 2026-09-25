import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type ClubConfig } from "../../api/client";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { LoadFailure } from "../../components/LoadFailure";
import { SuccessFeedback } from "../../components/SuccessFeedback";
import { TextField } from "../../components/TextField";
import { useReportedFailure } from "../../failures/useReportedFailure";
import { useRetry } from "../../failures/useRetry";
import { describedByMark } from "../../unsaved/markId";
import { UnsavedMark } from "../../unsaved/UnsavedMark";
import { ownedFields, useClubConfigForm } from "./clubConfigForm";

export function AdminDeadlinesView({ configurationChanged }: { configurationChanged: (config: ClubConfig) => void }) {
  const { t } = useTranslation();
  const { message: error, report, clear } = useReportedFailure();
  const { config, unsaved, loaded, applied, change, save: send } = useClubConfigForm(configurationChanged, ownedFields.deadlines);
  const [pending, setPending] = useState(false);
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

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!config || pending) return;
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
      ? (error ? <LoadFailure message={error} retry={() => { clear(); retryLoad(); }} /> : <p role="status">{t("status.loading")}</p>)
      : <>
        {error && <Alert testId="admin-error">{error}</Alert>}
        {success && <SuccessFeedback testId="admin-save-success">{success}</SuccessFeedback>}
        <form noValidate onSubmit={(event) => void save(event)} className="grid gap-5">
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
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" data-testid="save-deadlines" type="submit"
                    aria-describedby={describedByMark("deadlines", unsaved)}
                    disabled={pending}>{t("admin.save")}</Button>
            <UnsavedMark id="deadlines" unsaved={unsaved} />
          </div>
        </form>
      </>}
  </section>;
}
