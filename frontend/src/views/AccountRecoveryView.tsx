import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";

export function AccountRecoveryView() {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [asked, setAsked] = useState<"password" | "usernames">();

  function submit(field: string, ask: (value: string) => Promise<void>,
    outcome: "password" | "usernames") {
    return async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const value = new FormData(event.currentTarget).get(field);
      if (typeof value !== "string") {
        return;
      }
      setPending(true);
      setError(undefined);
      try {
        await ask(value);
        setAsked(outcome);
      } catch (failure) {
        setError(problemMessage(failure, t));
      } finally {
        setPending(false);
      }
    };
  }

  return <section data-testid="account-recovery-view" className="surface-panel w-full max-w-md rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <h1 className="text-2xl font-bold">{t("recovery.title")}</h1>
    <p className="text-muted mt-2">{t("recovery.description")}</p>
    {error && <div className="mt-6"><Alert>{error}</Alert></div>}
    {asked && <div className="mt-6">
      <Alert tone="success" testId="recovery-sent">{t(`recovery.${asked}.sent`)}</Alert>
    </div>}
    <form className="mt-8 grid gap-4" onSubmit={(event) => void submit("username", api.requestPasswordReset, "password")(event)}>
      <h2 className="text-xl font-bold">{t("recovery.password.title")}</h2>
      <p className="text-muted">{t("recovery.password.hint")}</p>
      <TextField id="recovery-username" name="username" label={t("auth.username")} data-testid="recovery-username" autoComplete="username" required />
      <Button variant="primary" type="submit" data-testid="recovery-password-submit" disabled={pending}>{t("recovery.password.submit")}</Button>
    </form>
    <form className="mt-10 grid gap-4" onSubmit={(event) => void submit("email", api.requestUsernameReminder, "usernames")(event)}>
      <h2 className="text-xl font-bold">{t("recovery.usernames.title")}</h2>
      <p className="text-muted">{t("recovery.usernames.hint")}</p>
      <TextField id="recovery-email" name="email" label={t("recovery.email")} data-testid="recovery-email" type="email" autoComplete="email" required />
      <Button variant="secondary" type="submit" data-testid="recovery-usernames-submit" disabled={pending}>{t("recovery.usernames.submit")}</Button>
    </form>
    <p className="mt-8">
      <Link data-testid="recovery-back-to-login" to="/login" className="font-semibold underline underline-offset-4">{t("recovery.backToSignIn")}</Link>
    </p>
  </section>;
}
