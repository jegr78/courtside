import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type SessionStatus } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";

export function HomeView({ session, signedOut }: { session: SessionStatus; signedOut: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string>();
  async function logout() {
    setError(undefined);
    try {
      await api.logout();
      signedOut();
    } catch (failure) {
      setError(problemMessage(failure, t));
    }
  }
  return <section data-testid="home-view" className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl sm:p-8">
    <h1 className="text-3xl font-bold text-slate-950">{t("home.welcome", { name: session.displayName })}</h1>
    <p className="mt-3 text-slate-600">{t("home.roles", { roles: session.roles.join(", ") })}</p>
    {error && <Alert>{error}</Alert>}
    <Button className="mt-8" type="button" data-testid="logout" onClick={() => void logout()}>{t("auth.logout")}</Button>
  </section>;
}
