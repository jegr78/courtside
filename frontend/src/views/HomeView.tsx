import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type SessionStatus } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { WeekView } from "./WeekView";

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
  return <section data-testid="home-view" className="w-full max-w-7xl rounded-2xl bg-white p-6 shadow-xl sm:p-8">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold text-slate-950">{t("home.welcome", { name: session.displayName })}</h1>
        <p className="mt-2 text-slate-600">{t("home.roles", { roles: session.roles.join(", ") })}</p>
      </div>
      <Button type="button" data-testid="logout" onClick={() => void logout()}>{t("auth.logout")}</Button>
    </div>
    {error && <Alert>{error}</Alert>}
    <WeekView />
  </section>;
}
