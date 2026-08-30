import { useEffect } from "react";
import { useBlocker } from "react-router-dom";
import { useUnsavedChanges } from "./registry";
import { UnsavedChangesQuestion } from "./UnsavedChangesQuestion";

const SIGN_IN = "/login";

export function UnsavedChangesGuard() {
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

  return <UnsavedChangesQuestion count={unsavedCount} stay={() => blocker.reset()} discard={() => blocker.proceed()} />;
}
