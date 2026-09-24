import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "./Alert";
import { Button } from "./Button";

export function LoadFailure({ message, retry }: { message: string; retry: () => void }) {
  const { t } = useTranslation();
  return <Alert testId="load-failure">
    <div className="flex flex-wrap items-center gap-3">
      <span>{message}</span>
      <Button variant="secondary" data-testid="retry-load" type="button" onClick={retry}>{t("error.retry")}</Button>
    </div>
  </Alert>;
}

export function useRetry(): [number, () => void] {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  return [attempt, retry];
}
