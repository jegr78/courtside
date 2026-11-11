import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { registerSW } from "virtual:pwa-register";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { SuccessFeedback } from "./SuccessFeedback";
import { recoverStaleDocument } from "../navigation/recoverStaleDocument";
import { holdsWaitingUpdate } from "./waitingUpdate";

interface PwaLifecycleProps {
  serverVersion?: string;
}

export function PwaLifecycle({ serverVersion }: PwaLifecycleProps) {
  const { t } = useTranslation();
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [registrationFailed, setRegistrationFailed] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const stale = serverVersion !== undefined && serverVersion !== __COURTSIDE_APP_VERSION__;

  useEffect(() => {
    registerSW({
      immediate: false,
      onNeedRefresh: () => void navigator.serviceWorker.getRegistration().then((registration) => {
        if (holdsWaitingUpdate(registration)) setNeedsRefresh(true);
      }, () => undefined),
      onRegisterError: () => setRegistrationFailed(true)
    });
  }, []);

  if (registrationFailed && !stale) {
    return <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl shadow-xl" data-testid="pwa-registration-warning">
      <Alert tone="warning">{t("pwa.registrationFailed")}</Alert>
    </div>;
  }
  if (!needsRefresh && !stale) {
    return null;
  }
  return <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl shadow-xl" data-testid="pwa-update-prompt">
    <SuccessFeedback>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{stale
          ? t("pwa.staleInterface", { interface: __COURTSIDE_APP_VERSION__, server: serverVersion })
          : t("pwa.updateAvailable")}</span>
        <Button variant="primary" data-testid="pwa-update" type="button" disabled={replacing} onClick={() => {
          setReplacing(true);
          void recoverStaleDocument({ unregisterWithoutWaiting: true }).catch(() => setReplacing(false));
        }}>
          {t("pwa.update")}
        </Button>
      </div>
    </SuccessFeedback>
  </div>;
}
