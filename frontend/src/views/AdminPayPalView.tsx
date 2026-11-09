import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError, type PayPalConnectionCheckResult, type PayPalEnvironment, type PayPalSettings,
  type PayPalSettingsRequest } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { useClubConfiguration } from "../club/registry";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { LoadFailure } from "../components/LoadFailure";
import { Modal } from "../components/Modal";
import { ReauthenticationCode } from "../components/ReauthenticationCode";
import { SuccessFeedback } from "../components/SuccessFeedback";
import { TextField } from "../components/TextField";
import { formString } from "../forms/formString";
import { reauthenticateForm } from "../security/reauthentication";
import { useProofContinuation } from "../security/useProofContinuation";
import { securityKeyFailure } from "../security/webauthn";
import { formatDateTime } from "../time/clubZone";
import { useUnsavedForm } from "../unsaved/useUnsavedForm";

const RECENT_AUTH = "urn:courtside:error:recent-authentication-required";
const ENVIRONMENTS: PayPalEnvironment[] = ["SANDBOX", "LIVE"];
const CLIENT_ID_LENGTH = 200;
const SECRET_LENGTH = 500;
const NOTHING_STORED: PayPalSettings = { clientId: null, environment: "SANDBOX", enabled: false, secretStoredAt: null };

type Change = { kind: "save"; settings: PayPalSettingsRequest } | { kind: "remove" };

export function AdminPayPalView() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? "de";
  const { club } = useClubConfiguration();
  const timeZone = club?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [settings, setSettings] = useState<PayPalSettings>();
  const [loadError, setLoadError] = useState<string>();
  const [loads, setLoads] = useState(0);
  const [generation, setGeneration] = useState(0);
  const settingsForm = useUnsavedForm("paypal");
  const proofContinuation = useProofContinuation("paypal");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [retry, setRetry] = useState<Change>();
  const [reauthenticationFailure, setReauthenticationFailure] = useState<string>();
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<PayPalConnectionCheckResult>();
  const [checkError, setCheckError] = useState<string>();

  useEffect(() => {
    let active = true;
    void api.payPalSettings().then((read) => {
      if (!active) return;
      setLoadError(undefined);
      setSettings(read);
    }).catch((failure: unknown) => { if (active) setLoadError(problemMessage(failure, t)); });
    return () => { active = false; };
  }, [loads, t]);

  async function apply(change: Change) {
    setPending(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      if (change.kind === "save") {
        setSettings(await api.savePayPalSettings(change.settings));
        setSuccess(t("admin.paypal.saved"));
      } else {
        await api.removePayPalCredentials();
        setConfirmingRemoval(false);
        setSettings(NOTHING_STORED);
        setSuccess(t("admin.paypal.removed"));
      }
      settingsForm.saved();
      setGeneration((count) => count + 1);
      setChecked(undefined);
    } catch (failure) {
      if (failure instanceof ApiError && failure.problem?.type === RECENT_AUTH) setRetry(change);
      else setError(problemMessage(failure, t));
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const clientId = formString(data, "clientId").trim();
    const secret = formString(data, "secret").trim();
    const environment = formString(data, "environment") === "LIVE" ? "LIVE" : "SANDBOX";
    setSuccess(undefined);
    if (!clientId) {
      setError(t("admin.paypal.clientIdRequired"));
      return;
    }
    void apply({ kind: "save", settings: { clientId, environment, enabled: data.has("enabled"), ...(secret ? { secret } : {}) } });
  }

  async function check() {
    setChecking(true);
    setChecked(undefined);
    setCheckError(undefined);
    try {
      setChecked(await api.checkPayPalConnection());
    } catch (failure) {
      setCheckError(problemMessage(failure, t));
    } finally {
      setChecking(false);
    }
  }

  async function reauthenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("admin-reauthentication-password");
    const requested = retry;
    if (typeof password !== "string" || !requested || pending) return;
    const ownsProof = proofContinuation.begin();
    setPending(true);
    setReauthenticationFailure(undefined);
    try {
      await reauthenticateForm(event.currentTarget, password);
    } catch (failure) {
      if (!ownsProof()) return;
      setReauthenticationFailure(securityKeyFailure(failure, t) ?? problemMessage(failure, t));
      setPending(false);
      return;
    }
    if (!ownsProof()) return;
    setRetry(undefined);
    await apply(requested);
  }

  const stored = settings !== undefined && (settings.clientId !== null || settings.secretStoredAt !== null);

  return <section data-testid="admin-paypal-view" className="surface-panel grid min-w-0 gap-8 rounded-2xl border p-4 shadow-[0_20px_50px_var(--cs-shadow)] [&>*]:max-w-3xl sm:p-8">
    <div className="grid gap-3">
      <h1 className="text-3xl font-bold">{t("admin.paypal.title")}</h1>
      <p className="text-muted">{t("admin.paypal.explain")}</p>
    </div>
    {!settings && (loadError
      ? <LoadFailure message={loadError} retry={() => { setLoadError(undefined); setLoads((count) => count + 1); }} />
      : <p role="status">{t("status.loading")}</p>)}
    {settings && <>
      {stored && settings.environment === "SANDBOX"
        && <Alert tone="warning" testId="paypal-sandbox-warning">{t("admin.paypal.sandboxWarning")}</Alert>}
      <form key={generation} noValidate {...settingsForm.form} onSubmit={submit} data-testid="paypal-form" className="grid gap-4">
        {error && <Alert testId="paypal-form-error">{error}</Alert>}
        {success && <SuccessFeedback testId="paypal-form-success">{success}</SuccessFeedback>}
        <TextField data-testid="paypal-client-id" name="clientId" required maxLength={CLIENT_ID_LENGTH} autoComplete="off"
          spellCheck={false} disabled={pending} defaultValue={settings.clientId ?? ""} label={t("admin.paypal.clientId")} />
        <fieldset className="grid gap-2" aria-describedby="paypal-environment-help">
          <legend className="font-medium">{t("admin.paypal.environmentLabel")}</legend>
          <div className="flex flex-wrap gap-4">
            {ENVIRONMENTS.map((environment) => <label key={environment} className="flex items-center gap-2">
              <input type="radio" name="environment" value={environment} data-testid={`paypal-environment-${environment}`}
                disabled={pending} defaultChecked={settings.environment === environment} />
              {t(`admin.paypal.environment.${environment}`)}
            </label>)}
          </div>
          <p id="paypal-environment-help" className="text-muted text-sm">{t("admin.paypal.environmentHelp")}</p>
        </fieldset>
        <label className="flex items-start gap-2">
          <input data-testid="paypal-enabled" name="enabled" type="checkbox" role="switch" className="mt-1" disabled={pending}
            defaultChecked={settings.enabled} aria-describedby="paypal-enabled-help" />
          <span className="grid gap-1">
            <span className="font-medium">{t("admin.paypal.enabled")}</span>
            <span id="paypal-enabled-help" className="text-muted text-sm">{t("admin.paypal.enabledHelp")}</span>
          </span>
        </label>
        <div className="grid gap-2">
          <TextField data-testid="paypal-secret" id="paypal-secret" name="secret" type="password" autoComplete="new-password"
            maxLength={SECRET_LENGTH} disabled={pending} label={t("admin.paypal.secret")}
            aria-describedby="paypal-secret-state paypal-secret-help" />
          <p id="paypal-secret-state" data-testid="paypal-secret-state" data-stored={settings.secretStoredAt ? "true" : "false"} className="text-sm">
            {settings.secretStoredAt
              ? t("admin.paypal.secretStoredSince", { dateTime: formatDateTime(settings.secretStoredAt, language, timeZone) })
              : t("admin.paypal.secretMissing")}
          </p>
          <p id="paypal-secret-help" className="text-muted text-sm">{t("admin.paypal.secretHelp")}</p>
        </div>
        <Button variant="primary" data-testid="paypal-save" type="submit" disabled={pending} className="justify-self-start">
          {t("admin.paypal.save")}
        </Button>
      </form>
      <section aria-labelledby="paypal-check-title" className="grid gap-3">
        <h2 id="paypal-check-title" className="text-xl font-bold">{t("admin.paypal.check")}</h2>
        <p className="text-muted text-sm">{t("admin.paypal.checkHelp")}</p>
        <Button variant="secondary" data-testid="paypal-check" type="button" disabled={checking} className="justify-self-start"
          onClick={() => void check()}>{t("admin.paypal.check")}</Button>
        {checkError && <Alert testId="paypal-check-error">{checkError}</Alert>}
        {checked && <div role="status" data-testid="paypal-check-result" data-outcome={checked.outcome} className="grid gap-1">
          <p className="font-semibold">{t(`admin.paypal.checkOutcome.${checked.outcome}`)}</p>
          {checked.outcome === "REJECTED" && checked.providerReason && <p data-testid="paypal-check-reason">
            {t("admin.paypal.checkReason", { reason: checked.providerReason })}
          </p>}
        </div>}
      </section>
      {stored && <section aria-labelledby="paypal-remove-title" className="grid gap-3">
        <h2 id="paypal-remove-title" className="text-xl font-bold">{t("admin.paypal.remove")}</h2>
        {confirmingRemoval ? <div className="grid gap-3">
          <p data-testid="paypal-remove-warning" className="font-semibold">{t("admin.paypal.removeWarning")}</p>
          <div className="flex flex-wrap gap-3">
            <Button variant="destructive" data-testid="paypal-remove-confirm" type="button" disabled={pending}
              onClick={() => void apply({ kind: "remove" })}>{t("admin.paypal.removeConfirm")}</Button>
            <Button variant="secondary" data-testid="paypal-remove-cancel" type="button" disabled={pending}
              onClick={() => setConfirmingRemoval(false)}>{t("admin.paypal.removeKeep")}</Button>
          </div>
        </div> : <Button variant="destructive" data-testid="paypal-remove" type="button" disabled={pending} className="justify-self-start"
          onClick={() => setConfirmingRemoval(true)}>{t("admin.paypal.remove")}</Button>}
      </section>}
    </>}
    {retry && <Modal labelledBy="admin-reauthentication-title" closed={() => {
      proofContinuation.cancel();
      setPending(false);
      setRetry(undefined);
      setReauthenticationFailure(undefined);
    }}>
      <form className="grid gap-4" onSubmit={(event) => void reauthenticate(event)}>
        <h2 id="admin-reauthentication-title" className="text-2xl font-bold">{t("accountSecurity.reauthenticateTitle")}</h2>
        <p>{t("accountSecurity.reauthenticate")}</p>
        {reauthenticationFailure && <Alert testId="admin-reauthentication-failure">{reauthenticationFailure}</Alert>}
        <TextField data-testid="admin-reauthentication-password" id="admin-reauthentication-password" name="admin-reauthentication-password"
          type="password" autoComplete="current-password" required label={t("auth.password")} />
        <ReauthenticationCode />
        <Button data-testid="admin-reauthentication-submit" variant="primary" disabled={pending} type="submit">{t("accountSecurity.continue")}</Button>
      </form>
    </Modal>}
  </section>;
}
