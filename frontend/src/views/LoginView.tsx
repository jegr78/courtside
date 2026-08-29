import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";

export function LoginView({ refreshSession, passwordChanged = false }: { refreshSession: () => Promise<void>; passwordChanged?: boolean }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(undefined);
    try {
      const username = data.get("username");
      const password = data.get("password");
      if (typeof username !== "string" || typeof password !== "string") {
        throw new Error("The sign-in form is incomplete");
      }
      await api.login(username, password);
      await refreshSession();
    } catch (failure) {
      setError(problemMessage(failure, t));
    } finally {
      setPending(false);
    }
  }

  return <section data-testid="login-view" className="surface-panel w-full max-w-md rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <h1 className="text-2xl font-bold">{t("auth.signIn")}</h1>
    <form className="mt-6 grid gap-5" onSubmit={(event) => void submit(event)}>
      {passwordChanged && <Alert>{t("password.changed")}</Alert>}
      {error && <Alert>{error}</Alert>}
      <TextField id="username" name="username" label={t("auth.username")} data-testid="username" autoComplete="username" required autoFocus />
      <TextField id="password" name="password" label={t("auth.password")} data-testid="password" type="password" autoComplete="current-password" required />
      <Button variant="primary" type="submit" data-testid="login-submit" disabled={pending}>{t("auth.submit")}</Button>
    </form>
  </section>;
}
