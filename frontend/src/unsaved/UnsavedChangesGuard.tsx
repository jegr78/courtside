import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker } from "react-router-dom";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { useUnsavedChanges } from "./registry";

export function UnsavedChangesGuard() {
  const { t } = useTranslation();
  const { unsavedCount } = useUnsavedChanges();
  const blocker = useBlocker(unsavedCount > 0);

  // useBlocker covers navigation inside the app and says so itself; a reload or a closed tab
  // reaches only this, and the wording there belongs to the browser.
  useEffect(() => {
    if (unsavedCount === 0) return;
    const ask = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [unsavedCount]);

  if (blocker.state !== "blocked") return null;

  return <Modal labelledBy="unsaved-changes-heading" closed={() => blocker.reset()}>
    <div data-testid="unsaved-changes" className="surface-panel w-full max-w-md rounded-2xl border p-6 shadow-2xl">
      <h3 id="unsaved-changes-heading" className="text-xl font-bold">{t("unsaved.title")}</h3>
      <p className="mt-3">{t("unsaved.question", { count: unsavedCount })}</p>
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary" type="button" data-testid="unsaved-changes-stay"
                onClick={() => blocker.reset()}>{t("unsaved.stay")}</Button>
        <Button variant="destructive" type="button" data-testid="unsaved-changes-discard"
                onClick={() => blocker.proceed()}>{t("unsaved.discard")}</Button>
      </div>
    </div>
  </Modal>;
}
