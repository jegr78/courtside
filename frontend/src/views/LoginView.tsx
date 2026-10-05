import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { loginWithCapacity } from "../api/loginWithCapacity";
import { isUnauthenticated, problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";

export function LoginView({ refreshSession, passwordChanged = false }: { refreshSession: (signal?: AbortSignal) => Promise<void>; passwordChanged?: boolean }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [waitingSeconds, setWaitingSeconds] = useState<number>();
  const attempt = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => {
    attempt.current?.abort();
    attempt.current = undefined;
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (attempt.current) return;
    const data = new FormData(event.currentTarget);
    const passwordField = event.currentTarget.elements.namedItem("password");
    if (passwordField instanceof HTMLInputElement) passwordField.value = "";
    const controller = new AbortController();
    attempt.current = controller;
    setPending(true);
    setError(undefined);
    setWaitingSeconds(undefined);
    try {
      const username = data.get("username");
      const password = data.get("password");
      if (typeof username !== "string" || typeof password !== "string") {
        throw new Error("The sign-in form is incomplete");
      }
      await loginWithCapacity(username, password, controller.signal, setWaitingSeconds, refreshSession);
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(isUnauthenticated(failure) ? t("auth.failed")
          : (failure instanceof Error || failure instanceof DOMException) && failure.name === "TimeoutError"
            ? t("auth.timedOut") : problemMessage(failure, t));
      }
    } finally {
      if (attempt.current === controller) {
        attempt.current = undefined;
        setWaitingSeconds(undefined);
        setPending(false);
      }
    }
  }

  return <section data-testid="login-view" className="surface-panel w-full max-w-md rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <h1 className="text-2xl font-bold">{t("auth.signIn")}</h1>
    <form className="mt-6 grid gap-5" onSubmit={(event) => void submit(event)}>
      {passwordChanged && <Alert tone="success">{t("password.changed")}</Alert>}
      {error && <Alert>{error}</Alert>}
      {waitingSeconds !== undefined && <Alert tone="info">{t("auth.waiting", { count: waitingSeconds })}</Alert>}
      <TextField id="username" name="username" label={t("auth.username")} data-testid="username" autoComplete="username" required autoFocus disabled={pending} />
      <TextField id="password" name="password" label={t("auth.password")} data-testid="password" type="password" autoComplete="current-password" required disabled={pending} />
      <Button variant="primary" type="submit" data-testid="login-submit" disabled={pending}>{t("auth.submit")}</Button>
    </form>
    <p className="mt-6">
      <Link data-testid="forgotten-credentials-link" to="/account-recovery" className="font-semibold underline underline-offset-4">{t("auth.forgotten")}</Link>
    </p>
  </section>;
}
