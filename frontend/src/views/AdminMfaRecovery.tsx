import { useContext, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type MfaAdministrativeStatus } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { ProofOwnerContext } from "../security/reauthentication";
import { useProofContinuation } from "../security/useProofContinuation";

export function AdminMfaRecovery({ accountId, disabled, run }: {
  accountId: string;
  disabled: boolean;
  run: (action: () => Promise<void>, message: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const owner = useContext(ProofOwnerContext);
  const continuation = useProofContinuation(accountId);
  const request = useRef<AbortController | undefined>(undefined);
  const [status, setStatus] = useState<MfaAdministrativeStatus>();
  const [failure, setFailure] = useState<string>();
  const [checked, setChecked] = useState(false);
  const [version, setVersion] = useState(0);
  useLayoutEffect(() => {
    const controller = new AbortController();
    setStatus(undefined);
    setFailure(undefined);
    setChecked(false);
    void api.accountMfa(accountId, controller.signal).then((value) => {
      if (!controller.signal.aborted) setStatus(value);
    }).catch((error) => { if (!controller.signal.aborted) setFailure(problemMessage(error, t)); });
    return () => { controller.abort(); request.current?.abort(); request.current = undefined; };
  }, [accountId, owner, t, version]);

  function recover() {
    if (!checked || disabled) return;
    const owns = continuation.begin();
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    void run(async () => {
      if (!owns()) return;
      await api.recoverAccountMfa(accountId, controller.signal);
      if (owns()) { setStatus({ enabled: false, recoveryPending: true }); setChecked(false); }
    }, "mfa.adminRecoveryStarted");
  }

  return <section data-testid="admin-mfa-recovery" className="grid gap-3 rounded-xl border p-4">
    <h2 className="text-2xl font-bold">{t("mfa.adminRecoveryTitle")}</h2>
    {failure && <><Alert>{failure}</Alert><Button variant="secondary" type="button" data-testid="admin-mfa-retry" onClick={() => setVersion((value) => value + 1)}>{t("error.retry")}</Button></>}
    {!status && !failure && <p role="status">{t("status.loading")}</p>}
    {status && <p data-testid="admin-mfa-status">{t(status.recoveryPending ? "mfa.adminRecoveryPending" : status.enabled ? "mfa.enabled" : "mfa.disabled")}</p>}
    {(status?.enabled || status?.recoveryPending) && <>
      <p className="text-muted">{t("mfa.adminRecoveryHint")}</p>
      <label className="flex items-start gap-3 py-3"><input className="mt-1 size-5 shrink-0" type="checkbox" data-testid="admin-mfa-identity-checked" checked={checked} disabled={disabled} onChange={(event) => setChecked(event.target.checked)} /><span>{t("mfa.adminIdentityChecked")}</span></label>
      <Button variant="destructive" type="button" data-testid="admin-mfa-recover" disabled={disabled || !checked} onClick={recover}>{t("mfa.adminRecoveryStart")}</Button>
    </>}
  </section>;
}
