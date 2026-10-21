import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { returnSearch } from "../navigation/returnTarget";

type RecoveryForm = "password" | "redeem" | "usernames";

export function AccountRecoveryView() {
  const { t } = useTranslation();
  const { search } = useLocation();
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<{ form: RecoveryForm; error?: string; done?: string }>();
  const outcome = useRef<HTMLDivElement>(null);

  useEffect(() => {
    outcome.current?.scrollIntoView?.({ block: "nearest" });
  }, [answer]);

  function submit(sent: RecoveryForm, act: (form: FormData) => Promise<void>, done: string) {
    return async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      setPending(true);
      setAnswer(undefined);
      try {
        await act(form);
        setAnswer({ form: sent, done });
      } catch (failure) {
        setAnswer({ form: sent, error: problemMessage(failure, t) });
      } finally {
        setPending(false);
      }
    };
  }

  function outcomeOf(form: RecoveryForm) {
    if (answer?.form !== form) return null;
    return <div ref={outcome}>
      {answer.error && <Alert>{answer.error}</Alert>}
      {answer.done && <Alert tone="success" testId="recovery-sent">{t(answer.done)}</Alert>}
    </div>;
  }

  function text(form: FormData, field: string) {
    const value = form.get(field);
    return typeof value === "string" ? value : "";
  }

  return <section data-testid="account-recovery-view" className="surface-panel w-full max-w-md rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <h1 className="text-2xl font-bold">{t("recovery.title")}</h1>
    <p className="text-muted mt-2">{t("recovery.description")}</p>
    <form className="mt-8 grid gap-4" onSubmit={(event) => void submit("password",
      (form) => api.requestPasswordReset(text(form, "username")), "recovery.password.sent")(event)}>
      <h2 className="text-xl font-bold">{t("recovery.password.title")}</h2>
      <p className="text-muted">{t("recovery.password.hint")}</p>
      <TextField id="recovery-username" name="username" label={t("auth.username")} data-testid="recovery-username" autoComplete="username" required />
      <Button variant="primary" type="submit" data-testid="recovery-password-submit" disabled={pending}>{t("recovery.password.submit")}</Button>
      {outcomeOf("password")}
    </form>
    <form className="mt-10 grid gap-4" onSubmit={(event) => void submit("redeem",
      (form) => api.redeemPasswordReset(text(form, "code").trim(), text(form, "new-password")), "recovery.redeem.done")(event)}>
      <h2 className="text-xl font-bold">{t("recovery.redeem.title")}</h2>
      <p className="text-muted">{t("recovery.redeem.hint")}</p>
      <TextField id="recovery-code" name="code" label={t("recovery.redeem.code")} data-testid="recovery-code" autoComplete="one-time-code" required />
      <TextField id="recovery-new-password" name="new-password" type="password" label={t("recovery.redeem.password")} data-testid="recovery-new-password" autoComplete="new-password" minLength={12} maxLength={256} required />
      <Button variant="primary" type="submit" data-testid="recovery-redeem-submit" disabled={pending}>{t("recovery.redeem.submit")}</Button>
      {outcomeOf("redeem")}
    </form>
    <form className="mt-10 grid gap-4" onSubmit={(event) => void submit("usernames",
      (form) => api.requestUsernameReminder(text(form, "email")), "recovery.usernames.sent")(event)}>
      <h2 className="text-xl font-bold">{t("recovery.usernames.title")}</h2>
      <p className="text-muted">{t("recovery.usernames.hint")}</p>
      <TextField id="recovery-email" name="email" label={t("recovery.email")} data-testid="recovery-email" type="email" autoComplete="email" required />
      <Button variant="secondary" type="submit" data-testid="recovery-usernames-submit" disabled={pending}>{t("recovery.usernames.submit")}</Button>
      {outcomeOf("usernames")}
    </form>
    <p className="mt-8">
      <Link data-testid="recovery-back-to-login" to={`/login${returnSearch(search)}`} className="font-semibold underline underline-offset-4">{t("recovery.backToSignIn")}</Link>
    </p>
  </section>;
}
