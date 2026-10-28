import { useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { SessionStatus } from "../api/client";
import { clearRecoveryCodes, currentRecoveryCodes, subscribe } from "../security/recoveryCodes";
import { Button } from "./Button";
import { Modal } from "./Modal";

export function RecoveryCodesNotice({ session, signedOut }: { session?: SessionStatus; signedOut: () => void }) {
  const { t } = useTranslation();
  const current = useSyncExternalStore(subscribe, currentRecoveryCodes);
  const switchedAccount = Boolean(current && session?.authenticated && session.username !== current.username);
  useEffect(() => { if (switchedAccount) clearRecoveryCodes(); }, [switchedAccount]);
  if (!current || switchedAccount) return null;
  return <Modal labelledBy="mfa-recovery-title" closed={() => undefined}>
    <div className="grid gap-4">
      <h2 id="mfa-recovery-title" className="text-xl font-bold">{t("mfa.recoveryTitle")}</h2>
      <p>{t("mfa.recoveryHint")}</p>
      <ul data-testid="mfa-recovery-codes" className="grid gap-2 font-mono text-sm">
        {current.codes.map((code) => <li key={code} className="break-all select-all">{code}</li>)}
      </ul>
      <Button variant="primary" type="button" data-testid="mfa-codes-saved" onClick={() => {
        clearRecoveryCodes();
        signedOut();
      }}>{t("mfa.codesSaved")}</Button>
    </div>
  </Modal>;
}
