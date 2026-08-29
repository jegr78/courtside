import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { registerSW } from "virtual:pwa-register";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { SuccessFeedback } from "./SuccessFeedback";

export function PwaLifecycle() {
  const { t } = useTranslation();
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [registrationFailed, setRegistrationFailed] = useState(false);
  const update = useRef<ReturnType<typeof registerSW> | undefined>(undefined);

  useEffect(() => {
    update.current = registerSW({
      immediate: false,
      onNeedRefresh: () => setNeedsRefresh(true),
      onRegisterError: () => setRegistrationFailed(true)
    });
  }, []);

  if (registrationFailed) {
    return <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl shadow-xl" data-testid="pwa-registration-warning">
      <Alert>{t("pwa.registrationFailed")}</Alert>
    </div>;
  }
  if (!needsRefresh) {
    return null;
  }
  return <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl shadow-xl" data-testid="pwa-update-prompt">
    <SuccessFeedback>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{t("pwa.updateAvailable")}</span>
        <Button variant="primary" data-testid="pwa-update" type="button" onClick={() => void update.current?.(true)}>
          {t("pwa.update")}
        </Button>
      </div>
    </SuccessFeedback>
  </div>;
}
