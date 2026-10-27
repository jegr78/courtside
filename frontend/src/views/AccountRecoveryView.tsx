import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api/client";
import { abortable } from "../api/abortable";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { returnSearch } from "../navigation/returnTarget";

type RecoveryForm = "password" | "redeem" | "usernames" | "mfa";

export function AccountRecoveryView() {
  const { t } = useTranslation();
  const { search } = useLocation();
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<{ form: RecoveryForm; error?: string; done?: string }>();
  const attempt = useRef<AbortController | undefined>(undefined);
  const outcome = useRef<HTMLDivElement>(null);

  useEffect(() => {
    outcome.current?.scrollIntoView?.({ block: "nearest" });
  }, [answer]);

  useEffect(() => () => { attempt.current?.abort(); attempt.current = undefined; }, []);

  function submit(sent: RecoveryForm, act: (form: FormData, signal: AbortSignal) => Promise<void>, done: string) {
    return async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (attempt.current) return;
      const form = new FormData(event.currentTarget);
      const controller = new AbortController();
      attempt.current = controller;
      setPending(true);
      setAnswer(undefined);
      try {
        await abortable(() => act(form, controller.signal), controller.signal);
        controller.signal.throwIfAborted();
        setAnswer({ form: sent, done });
      } catch (failure) {
        if (!controller.signal.aborted) setAnswer({ form: sent, error: problemMessage(failure, t) });
      } finally {
        if (attempt.current === controller) { attempt.current = undefined; setPending(false); }
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
    <form id="controlled-mfa" className="mt-10 grid gap-4" onSubmit={(event) => {
      event.preventDefault();
      const current = event.currentTarget;
      const data = new FormData(current);
      if (text(data, "password") !== text(data, "password-confirm")) {
        setAnswer({ form: "mfa", error: t("password.mismatch") });
        return;
      }
      void submit("mfa", async (form, signal) => {
        await api.redeemMfaRecovery(text(form, "username"), text(form, "code").trim(), text(form, "password"), signal);
        signal.throwIfAborted();
        current.reset();
      }, "mfa.recoveryRedeemed")(event);
    }}>
      <h2 className="text-xl font-bold">{t("mfa.recoveryTitleControlled")}</h2>
      <p className="text-muted">{t("mfa.recoveryControlledHint")}</p>
      <TextField id="controlled-mfa-username" name="username" data-testid="controlled-mfa-username" label={t("auth.username")} autoComplete="username" required disabled={pending} />
      <TextField id="controlled-mfa-code" name="code" data-testid="controlled-mfa-code" label={t("recovery.redeem.code")} autoComplete="one-time-code" maxLength={128} required disabled={pending} />
      <TextField id="controlled-mfa-password" name="password" data-testid="controlled-mfa-password" type="password" label={t("password.new")} autoComplete="new-password" minLength={12} maxLength={256} required disabled={pending} />
      <TextField id="controlled-mfa-password-confirm" name="password-confirm" data-testid="controlled-mfa-password-confirm" type="password" label={t("password.confirm")} autoComplete="new-password" minLength={12} maxLength={256} required disabled={pending} />
      <Button variant="primary" type="submit" data-testid="controlled-mfa-submit" disabled={pending}>{t("mfa.recoveryRedeem")}</Button>
      {outcomeOf("mfa")}
    </form>
    <p className="mt-8">
      <Link data-testid="recovery-back-to-login" to={`/login${returnSearch(search)}`} className="font-semibold underline underline-offset-4">{t("recovery.backToSignIn")}</Link>
    </p>
  </section>;
}
