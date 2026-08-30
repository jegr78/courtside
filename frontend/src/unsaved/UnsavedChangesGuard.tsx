import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker } from "react-router-dom";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { useUnsavedChanges } from "./registry";

const SIGN_IN = "/login";

export function UnsavedChangesGuard() {
  const { t } = useTranslation();
  const { unsavedCount } = useUnsavedChanges();

  // Signing out and an expired session both redirect here, and by then the work cannot be saved
  // any more — holding that redirect would strand somebody on a page that refuses every request.
  const blocker = useBlocker(({ nextLocation }) =>
    unsavedCount > 0 && nextLocation.pathname !== SIGN_IN);

  // react-router leaves "blocked" only through proceed or reset, never because the reason expired,
  // so a question whose work has since gone would keep standing and count nothing.
  useEffect(() => {
    if (blocker.state === "blocked" && unsavedCount === 0) {
      blocker.reset();
    }
  }, [blocker, unsavedCount]);

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
