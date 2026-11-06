import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { useClubConfiguration } from "../club/registry";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";

export function RegisterView() {
  const { t, i18n } = useTranslation();
  const { club } = useClubConfiguration();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  const language = i18n.language.startsWith("de") ? "de" : "en";
  const text = language === "de" ? club?.registrationTextDe : club?.registrationTextEn;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (field: string) => {
      const entered = form.get(field);
      return typeof entered === "string" ? entered : "";
    };
    setPending(true);
    setError(undefined);
    try {
      await api.register({
        firstName: value("first-name").trim(), lastName: value("last-name").trim(), username: value("username").trim(),
        password: value("password"), email: value("email").trim(), language
      });
      setSent(true);
    } catch (failure) {
      setError(problemMessage(failure, t));
    } finally {
      setPending(false);
    }
  }

  return <section data-testid="register-view" className="surface-panel w-full max-w-md rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <h1 className="text-2xl font-bold">{t("registration.title")}</h1>
    {text && <p data-testid="registration-text" className="mt-2 whitespace-pre-line">{text}</p>}
    {sent
      ? <Alert tone="success" testId="registration-sent">{t("registration.sent")}</Alert>
      : <form className="mt-6 grid gap-4" onSubmit={(event) => void submit(event)}>
        <TextField id="registration-first-name" name="first-name" label={t("registration.firstName")} data-testid="registration-first-name" autoComplete="given-name" maxLength={60} required />
        <TextField id="registration-last-name" name="last-name" label={t("registration.lastName")} data-testid="registration-last-name" autoComplete="family-name" maxLength={60} required />
        <TextField id="registration-email" name="email" type="email" label={t("registration.email")} data-testid="registration-email" autoComplete="email" maxLength={120} required />
        <TextField id="registration-username" name="username" label={t("auth.username")} data-testid="registration-username" autoComplete="username" minLength={3} maxLength={60} pattern="[a-z0-9._-]+" required />
        <TextField id="registration-password" name="password" type="password" label={t("auth.password")} data-testid="registration-password" autoComplete="new-password" minLength={12} maxLength={256} required />
        {error && <Alert>{error}</Alert>}
        <Button variant="primary" type="submit" data-testid="registration-submit" disabled={pending}>{t("registration.submit")}</Button>
      </form>}
    <p className="mt-6"><Link to="/login" className="font-semibold underline underline-offset-4">{t("registration.toLogin")}</Link></p>
  </section>;
}
