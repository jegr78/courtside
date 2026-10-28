import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { abortable } from "../api/abortable";
import { api } from "../api/client";
import { loginWithCapacity } from "../api/loginWithCapacity";
import { isUnauthenticated, problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { getSecurityKey, supportsSecurityKeys } from "../security/webauthn";
import { returnSearch } from "../navigation/returnTarget";

export function LoginView({ refreshSession, passwordChanged = false, mfaRequired = false, totpAvailable = true, webauthnAvailable = false }: { refreshSession: (signal?: AbortSignal) => Promise<void>; passwordChanged?: boolean; mfaRequired?: boolean; totpAvailable?: boolean; webauthnAvailable?: boolean }) {
  const { t } = useTranslation();
  const { search } = useLocation();
  const [factorStage, setFactorStage] = useState<boolean>();
  const factorRequired = factorStage ?? mfaRequired;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [waitingSeconds, setWaitingSeconds] = useState<number>();
  const attempt = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") attempt.current?.abort(); };
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("keydown", cancel);
      attempt.current?.abort();
      attempt.current = undefined;
    };
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
      const outcome = await loginWithCapacity(username, password, controller.signal, setWaitingSeconds, refreshSession);
      if (!controller.signal.aborted && outcome === "mfa-required") setFactorStage(true);
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

  async function completeFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (attempt.current) return;
    const form = event.currentTarget;
    const code = new FormData(form).get("mfa-code");
    if (typeof code !== "string") return;
    const controller = new AbortController();
    attempt.current = controller;
    setPending(true);
    setError(undefined);
    form.reset();
    const deadline = setTimeout(() => controller.abort(new DOMException("Sign-in timed out", "TimeoutError")), 15_000);
    try {
      await abortable(() => api.completeMfaLogin(code, controller.signal), controller.signal);
      controller.signal.throwIfAborted();
      await abortable(() => refreshSession(controller.signal), controller.signal);
    } catch (failure) {
      if (attempt.current === controller) {
        if (failure instanceof DOMException && failure.name === "TimeoutError") setError(t("auth.timedOut"));
        else if (!controller.signal.aborted) setError(problemMessage(failure, t));
      }
    } finally {
      clearTimeout(deadline);
      if (attempt.current === controller) {
        attempt.current = undefined;
        setPending(false);
      }
    }
  }


  async function completeSecurityKey() {
    if (attempt.current) return;
    const controller = new AbortController();
    attempt.current = controller;
    setPending(true);
    setError(undefined);
    const deadline = setTimeout(() => controller.abort(new DOMException("Sign-in timed out", "TimeoutError")), 60_000);
    try {
      const options = await abortable(() => api.webauthnLoginOptions(controller.signal), controller.signal);
      const credential = await getSecurityKey(options, controller.signal);
      controller.signal.throwIfAborted();
      await abortable(() => api.completeWebauthnLogin(credential, controller.signal), controller.signal);
      controller.signal.throwIfAborted();
      await abortable(() => refreshSession(controller.signal), controller.signal);
    } catch (failure) {
      if (attempt.current === controller && !controller.signal.aborted) {
        setError(failure instanceof DOMException && failure.name === "NotAllowedError" ? t("mfa.keyCancelled") : problemMessage(failure, t));
      }
    } finally {
      clearTimeout(deadline);
      if (attempt.current === controller) {
        attempt.current = undefined;
        setPending(false);
      }
    }
  }

  async function restart() {
    if (attempt.current) return;
    const controller = new AbortController();
    attempt.current = controller;
    setPending(true);
    setError(undefined);
    const deadline = setTimeout(() => controller.abort(new DOMException("Sign-in timed out", "TimeoutError")), 15_000);
    try {
      await abortable(() => api.logout(controller.signal), controller.signal);
      controller.signal.throwIfAborted();
      await abortable(() => refreshSession(controller.signal), controller.signal);
      controller.signal.throwIfAborted();
      setFactorStage(false);
    } catch (failure) {
      if (attempt.current === controller) {
        if (failure instanceof DOMException && failure.name === "TimeoutError") setError(t("auth.timedOut"));
        else if (!controller.signal.aborted) setError(problemMessage(failure, t));
      }
    } finally {
      clearTimeout(deadline);
      if (attempt.current === controller) {
        attempt.current = undefined;
        setPending(false);
      }
    }
  }

  return <section data-testid="login-view" className="surface-panel w-full max-w-md rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <h1 className="text-2xl font-bold">{t("auth.signIn")}</h1>
    {factorRequired ? <form key="factor" className="mt-6 grid gap-5" onSubmit={(event) => void completeFactor(event)}>
      <p>{t(totpAvailable ? "mfa.loginHint" : "mfa.recoveryLoginHint")}</p>
      {error && <Alert>{error}</Alert>}
      {webauthnAvailable && supportsSecurityKeys() && <Button variant="secondary" type="button" data-testid="login-security-key" disabled={pending} onClick={() => void completeSecurityKey()}>{t("mfa.useKey")}</Button>}
      <TextField id="mfa-code" name="mfa-code" data-testid="login-mfa-code" label={t("mfa.code")} autoComplete="one-time-code" autoFocus required maxLength={128} disabled={pending} />
      <Button variant="primary" type="submit" data-testid="login-mfa-submit" disabled={pending}>{t("auth.submit")}</Button>
      <Link data-testid="login-mfa-help" to={`/account-recovery${returnSearch(search)}#controlled-mfa`} className="font-semibold underline underline-offset-4">{t("mfa.lostFactors")}</Link>
      <Button variant="secondary" type="button" data-testid="login-mfa-restart" disabled={pending} onClick={() => void restart()}>{t("mfa.restart")}</Button>
    </form> : <form key="password" className="mt-6 grid gap-5" onSubmit={(event) => void submit(event)}>
      {passwordChanged && <Alert tone="success">{t("password.changed")}</Alert>}
      {error && <Alert>{error}</Alert>}
      {waitingSeconds !== undefined && <Alert tone="info">{t("auth.waiting", { count: waitingSeconds })}</Alert>}
      <TextField id="username" name="username" label={t("auth.username")} data-testid="username" autoComplete="username" required autoFocus disabled={pending} />
      <TextField id="password" name="password" label={t("auth.password")} data-testid="password" type="password" autoComplete="current-password" required disabled={pending} />
      <Button variant="primary" type="submit" data-testid="login-submit" disabled={pending}>{t("auth.submit")}</Button>
    </form>}
    {!factorRequired && <p className="mt-6">
      <Link data-testid="forgotten-credentials-link" to={`/account-recovery${returnSearch(search)}`} className="font-semibold underline underline-offset-4">{t("auth.forgotten")}</Link>
    </p>}
  </section>;
}
