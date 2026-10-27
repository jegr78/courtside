import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import qrcode from "qrcode-generator";
import { api, type MfaRecoveryCodeSet, type MfaStatus, type TotpEnrollment } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { showRecoveryCodes } from "../security/recoveryCodes";

export function MfaSettings({ username, pending, run, signedOut }: {
  username?: string;
  pending: boolean;
  run: (action: () => Promise<void>, completed?: () => void) => Promise<void>;
  signedOut: (preserveRecoveryCodes?: boolean) => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<MfaStatus>();
  const [failure, setFailure] = useState<string>();
  const [loadVersion, setLoadVersion] = useState(0);
  const [enrollment, setEnrollment] = useState<TotpEnrollment>();
  useEffect(() => {
    let active = true;
    void api.ownMfa().then((value) => { if (active) { setStatus(value); setFailure(undefined); } })
      .catch((error) => { if (active) setFailure(problemMessage(error, t)); });
    return () => { active = false; };
  }, [t, loadVersion]);

  function begin() {
    let next: TotpEnrollment;
    return run(async () => { next = await api.beginTotpEnrollment(); }, () => setEnrollment(next));
  }

  function changed(action: () => Promise<MfaRecoveryCodeSet>) {
    let result: MfaRecoveryCodeSet;
    return run(async () => { result = await action(); }, () => {
      if (result.codes.length) showRecoveryCodes(result.codes, username);
      setEnrollment(undefined);
      signedOut(result.codes.length > 0);
    });
  }

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get("totp-confirmation-code");
    if (typeof code === "string") void changed(() => api.confirmTotpEnrollment(code));
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
        {status.totpEnabled && <Button variant="destructive" type="button" data-testid="mfa-remove-totp" disabled={pending} onClick={() => void run(api.removeTotp, signedOut)}>{t("mfa.removeTotp")}</Button>}
        {status.enabled && <>
          <Button variant="secondary" type="button" data-testid="mfa-replace-recovery" disabled={pending} onClick={() => void changed(api.replaceRecoveryCodes)}>{t("mfa.replaceRecovery")}</Button>
          <Button variant="destructive" type="button" data-testid="mfa-disable" disabled={pending} onClick={() => void run(api.disableMfa, signedOut)}>{t("mfa.disable")}</Button>
        </>}
      </div>}
    </>}
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
