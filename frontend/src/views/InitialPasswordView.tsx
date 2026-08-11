import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";

export function InitialPasswordView({ changed }: { changed: () => void }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const passwordValue = data.get("password");
    const confirmationValue = data.get("confirmation");
    if (typeof passwordValue !== "string" || typeof confirmationValue !== "string") {
      setError(t("error.generic"));
      return;
    }
    const password = passwordValue;
    if (password.length < 12) {
      setError(t("password.tooShort"));
      return;
    }
    if (password !== confirmationValue) {
      setError(t("password.mismatch"));
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      await api.changeInitialPassword(password);
      changed();
    } catch (failure) {
      setError(problemMessage(failure, t));
    } finally {
      setPending(false);
    }
  }

  return <section data-testid="initial-password-view" className="surface-panel w-full max-w-md rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <h1 className="text-2xl font-bold">{t("password.title")}</h1>
    <p className="text-muted mt-2">{t("password.description")}</p>
    <form className="mt-6 grid gap-5" onSubmit={(event) => void submit(event)}>
      {error && <Alert>{error}</Alert>}
      <TextField id="new-password" name="password" label={t("password.new")} data-testid="new-password" type="password" autoComplete="new-password" minLength={12} required autoFocus />
      <TextField id="confirm-password" name="confirmation" label={t("password.confirm")} data-testid="confirm-password" type="password" autoComplete="new-password" minLength={12} required />
      <Button type="submit" data-testid="password-submit" disabled={pending}>{t("password.submit")}</Button>
    </form>
  </section>;
}
