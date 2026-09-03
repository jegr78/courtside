import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useReportedFailure } from "../../failures/useReportedFailure";

export function useSaving() {
  const { t } = useTranslation();
  const { message: error, report, refuse: refuseWith, clear } = useReportedFailure();
  const [success, setSuccess] = useState<string>();
  const pendingRef = useRef(new Set<string>());
  const [pending, setPending] = useState(new Set<string>());

  const reportError = useCallback((failure: unknown) => {
    setSuccess(undefined);
    report(failure);
  }, [report]);

  // A form that refuses its own body has a better answer than "please try again", and it still
  // has to take back whatever the last save said.
  const refuse = useCallback((message: string) => {
    setSuccess(undefined);
    refuseWith(message);
  }, [refuseWith]);

  function replacePending(changed: Set<string>) {
    pendingRef.current = changed;
    setPending(changed);
  }

  // The set is read from the ref rather than from state, so two clicks within one render pass
  // cannot both walk past the guard and send the same request twice.
  async function save(key: string, work: () => Promise<void>) {
    if (pendingRef.current.has(key)) return;
    replacePending(new Set(pendingRef.current).add(key));
    try {
      await work();
      clear();
      setSuccess(t("admin.facility.saved"));
    } catch (failure) {
      reportError(failure);
    } finally {
      const remaining = new Set(pendingRef.current);
      remaining.delete(key);
      replacePending(remaining);
    }
  }

  return { error, success, pending, reportError, refuse, save };
}
