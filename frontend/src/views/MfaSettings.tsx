import { type FormEvent, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import qrcode from "qrcode-generator";
import { api, type MfaRecoveryCodeSet, type MfaStatus, type TotpEnrollment } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { abortable } from "../api/abortable";
import { createSecurityKey, supportsSecurityKeys } from "../security/webauthn";
import { ProofOwnerContext } from "../security/reauthentication";
import { showRecoveryCodes } from "../security/recoveryCodes";

export function MfaSettings({ username, pending, run, signedOut }: {
  username?: string;
  pending: boolean;
  run: (action: (signal?: AbortSignal) => Promise<void>, completed?: () => void) => Promise<void>;
  signedOut: (preserveRecoveryCodes?: boolean) => void;
}) {
  const { t } = useTranslation();
  const owner = useContext(ProofOwnerContext);
  const accountLifetime = useRef(new AbortController());
  const [status, setStatus] = useState<MfaStatus>();
  const [failure, setFailure] = useState<string>();
  const [loadVersion, setLoadVersion] = useState(0);
  const keyAttempt = useRef<AbortController | undefined>(undefined);
  const [keyPending, setKeyPending] = useState(false);
  const [keyPreparing, setKeyPreparing] = useState(false);
  const [enrollment, setEnrollment] = useState<TotpEnrollment>();
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void api.ownMfa(AbortSignal.any([controller.signal, accountLifetime.current.signal])).then((value) => { if (active) { setStatus(value); setFailure(undefined); } })
      .catch((error) => { if (active) setFailure(problemMessage(error, t)); });
    return () => { active = false; controller.abort(); };
  }, [t, loadVersion, owner, username]);

  useLayoutEffect(() => {
    const lifetime = new AbortController();
    accountLifetime.current = lifetime;
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") keyAttempt.current?.abort(); };
    window.addEventListener("keydown", cancel);
    return () => { lifetime.abort(); window.removeEventListener("keydown", cancel); keyAttempt.current?.abort(); keyAttempt.current = undefined; };
  }, [username, owner]);

  function registerKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = new FormData(event.currentTarget).get("mfa-key-label");
    if (typeof label !== "string" || !label.trim() || keyAttempt.current) return;
    let result: MfaRecoveryCodeSet;
    const actorSignal = accountLifetime.current.signal;
    return run(async (proofSignal) => {
      const controller = new AbortController();
      keyAttempt.current = controller;
      const preparation = AbortSignal.any([controller.signal, actorSignal, ...(proofSignal ? [proofSignal] : [])]);
      setKeyPending(true);
      setKeyPreparing(true);
      try {
        const options = await abortable(() => api.webauthnRegistrationOptions(preparation), preparation);
        const credential = await createSecurityKey(options, preparation);
        preparation.throwIfAborted();
        setKeyPreparing(false);
        result = await abortable(() => api.registerWebauthn(label.trim(), credential, actorSignal), actorSignal);
      } finally {
        if (keyAttempt.current === controller) { keyAttempt.current = undefined; setKeyPending(false); setKeyPreparing(false); }
      }
    }, () => {
      if (result.codes.length) showRecoveryCodes(result.codes, username);
      signedOut(result.codes.length > 0);
    });
  }

  function renameKey(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const label = new FormData(event.currentTarget).get("device-label");
    if (typeof label !== "string" || !label.trim()) return;
    void mutate((signal) => api.renameWebauthn(id, label.trim(), signal));
  }

  function mutate(action: (signal: AbortSignal) => Promise<void>) {
    const signal = accountLifetime.current.signal;
    return run(async () => { await abortable(() => action(signal), signal); signal.throwIfAborted(); }, () => { if (!signal.aborted) signedOut(); });
  }

  function begin() {
    let next: TotpEnrollment;
    const signal = accountLifetime.current.signal;
    return run(async () => { next = await abortable(() => api.beginTotpEnrollment(signal), signal); signal.throwIfAborted(); }, () => { if (!signal.aborted) setEnrollment(next); });
  }

  function changed(action: (signal: AbortSignal) => Promise<MfaRecoveryCodeSet>) {
    let result: MfaRecoveryCodeSet;
    const signal = accountLifetime.current.signal;
    return run(async () => { result = await abortable(() => action(signal), signal); signal.throwIfAborted(); }, () => {
      if (signal.aborted) return;
      if (result.codes.length) showRecoveryCodes(result.codes, username);
      setEnrollment(undefined);
      signedOut(result.codes.length > 0);
    });
  }

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get("totp-confirmation-code");
    if (typeof code === "string") void changed((signal) => api.confirmTotpEnrollment(code, signal));
  }

  return <section data-testid="mfa-settings" className="grid gap-4">
    <h3 className="text-xl font-bold">{t("mfa.title")}</h3>
    <p>{t("mfa.description")}</p>
    {failure && <><Alert>{failure}</Alert><Button variant="secondary" type="button" data-testid="mfa-retry" onClick={() => setLoadVersion((value) => value + 1)}>{t("error.retry")}</Button></>}
    {!status && !failure && <p role="status">{t("status.loading")}</p>}
    {status && <>
      <p data-testid="mfa-status">{t(status.enabled ? "mfa.enabled" : "mfa.disabled")}</p>
      {status.enabled && <p data-testid="mfa-recovery-remaining">{t("mfa.remaining", { count: status.recoveryCodesRemaining })}</p>}
      {!enrollment && <div className="flex flex-wrap gap-3">
        <Button variant="secondary" type="button" data-testid="mfa-enroll-totp" disabled={pending} onClick={() => void begin()}>{t(status.totpEnabled ? "mfa.replaceTotp" : "mfa.enrollTotp")}</Button>
        {status.totpEnabled && <Button variant="destructive" type="button" data-testid="mfa-remove-totp" disabled={pending} onClick={() => void mutate(api.removeTotp)}>{t("mfa.removeTotp")}</Button>}
        {status.enabled && <>
          <Button variant="secondary" type="button" data-testid="mfa-replace-recovery" disabled={pending} onClick={() => void changed(api.replaceRecoveryCodes)}>{t("mfa.replaceRecovery")}</Button>
          <Button variant="destructive" type="button" data-testid="mfa-disable" disabled={pending} onClick={() => void mutate(api.disableMfa)}>{t("mfa.disable")}</Button>
        </>}
      </div>}
    </>}
    {status && <section className="grid gap-4 rounded-xl border p-4">
      <h4 className="font-bold">{t("mfa.keyList")}</h4>
      <p className="text-muted text-sm">{t("mfa.keyPrivacy")}</p>
      {(status.devices ?? []).map((device) => <form key={device.id} className="grid gap-3 rounded-lg border p-3" onSubmit={(event) => renameKey(event, device.id)}>
        <TextField id={`mfa-device-${device.id}`} name="device-label" data-testid={`mfa-device-label-${device.id}`} label={t("mfa.keyLabel")} defaultValue={device.label} maxLength={100} required disabled={pending || keyPending} />
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" type="submit" data-testid={`mfa-device-rename-${device.id}`} disabled={pending || keyPending}>{t("mfa.keyRename")}</Button>
          <Button variant="destructive" type="button" data-testid={`mfa-device-remove-${device.id}`} disabled={pending || keyPending} onClick={() => void mutate((signal) => api.removeWebauthn(device.id, signal))}>{t("mfa.keyRemove")}</Button>
        </div>
      </form>)}
      {status.webauthnAvailable && supportsSecurityKeys() ? <form className="grid gap-3" onSubmit={(event) => void registerKey(event)}>
        <TextField id="mfa-key-label" name="mfa-key-label" data-testid="mfa-key-label" label={t("mfa.keyLabel")} maxLength={100} required disabled={pending || keyPending} />
        <Button variant="secondary" type="submit" data-testid="mfa-add-key" disabled={pending || keyPending}>{t("mfa.addKey")}</Button>
        {keyPreparing && <Button variant="secondary" type="button" data-testid="mfa-cancel-key" onClick={() => keyAttempt.current?.abort()}>{t("mfa.cancel")}</Button>}
      </form> : <p data-testid="mfa-key-unavailable" className="text-muted text-sm">{t("mfa.keyUnavailable")}</p>}
    </section>}
    {enrollment && <form className="grid gap-4 rounded-xl border p-4" onSubmit={confirm}>
      <p>{t("mfa.setupHint")}</p>
      <EnrollmentQr uri={enrollment.uri} />
      <div><p>{t("mfa.manualKey")}</p><code data-testid="mfa-manual-key" className="break-all select-all font-mono">{enrollment.secret}</code></div>
      <TextField id="totp-confirmation-code" name="totp-confirmation-code" data-testid="mfa-confirm-code" label={t("mfa.totpCode")} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required disabled={pending} />
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" type="submit" data-testid="mfa-confirm-totp" disabled={pending}>{t("mfa.confirmTotp")}</Button>
        <Button variant="secondary" type="button" data-testid="mfa-cancel-totp" disabled={pending} onClick={() => setEnrollment(undefined)}>{t("mfa.cancel")}</Button>
      </div>
    </form>}
    {status?.enabled && <p className="text-muted text-sm">{t("mfa.changesSignOut")}</p>}
  </section>;
}

function EnrollmentQr({ uri }: { uri: string }) {
  const { t } = useTranslation();
  const qr = qrcode(0, "M");
  qr.addData(uri, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  let path = "";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.isDark(row, col)) path += `M${col + 4},${row + 4}h1v1h-1z`;
    }
  }
  return <svg data-testid="mfa-qr" role="img" aria-label={t("mfa.qrLabel")} viewBox={`0 0 ${size + 8} ${size + 8}`} className="h-auto w-full max-w-64" shapeRendering="crispEdges">
    <rect width={size + 8} height={size + 8} fill="white" />
    <path d={path} fill="black" />
  </svg>;
}
