import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api, type ClubConfig, type SessionStatus, type SourceOffer } from "./api/client";
import { Alert } from "./components/Alert";
import { applyAccountLocale, supportedLocale } from "./i18n";
import { HomeView } from "./views/HomeView";
import { InitialPasswordView } from "./views/InitialPasswordView";
import { LoginView } from "./views/LoginView";

interface AppRoutesProps {
  session: SessionStatus;
  refreshSession: () => Promise<void>;
  passwordChanged?: boolean;
  initialPasswordChanged?: () => void;
  signedOut?: () => void;
}

export function AppRoutes({ session, refreshSession, passwordChanged, initialPasswordChanged, signedOut }: AppRoutesProps) {
  if (session.passwordChangeRequired) {
    return <Routes>
      <Route path="/initial-password" element={<InitialPasswordView changed={() => initialPasswordChanged?.()} />} />
      <Route path="*" element={<Navigate to="/initial-password" replace />} />
    </Routes>;
  }
  if (!session.authenticated) {
    return <Routes>
      <Route path="/login" element={<LoginView refreshSession={refreshSession} passwordChanged={passwordChanged} />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>;
  }
  return <Routes>
    <Route path="/" element={<HomeView session={session} signedOut={() => signedOut?.()} />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}

function applyBranding(config: ClubConfig) {
  document.title = config.clubName;
  document.documentElement.style.setProperty("--club-primary", config.primaryColor);
  document.documentElement.style.setProperty("--club-accent", config.accentColor);
}

export function App() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionStatus>();
  const [config, setConfig] = useState<ClubConfig>();
  const [source, setSource] = useState<SourceOffer>();
  const [offline, setOffline] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  const refreshSession = useCallback(async () => {
    const current = await api.session();
    setSession(current);
    setOffline(false);
    const accountLocale = supportedLocale(current.locale);
    if (accountLocale) {
      await applyAccountLocale(accountLocale);
    }
  }, []);

  useEffect(() => {
    void Promise.all([
      refreshSession().catch(() => setOffline(true)),
      api.config().then((value) => { setConfig(value); applyBranding(value); }).catch(() => undefined),
      api.source().then(setSource).catch(() => undefined)
    ]);
    const unauthenticated = () => {
      setSession({ authenticated: false, roles: [], passwordChangeRequired: false });
      void navigate("/login");
    };
    window.addEventListener("courtside:unauthenticated", unauthenticated);
    return () => window.removeEventListener("courtside:unauthenticated", unauthenticated);
  }, [navigate, refreshSession]);

  function initialPasswordChanged() {
    setPasswordChanged(true);
    setSession({ authenticated: false, roles: [], passwordChangeRequired: false });
    void navigate("/login");
  }

  function signOut() {
    setSession({ authenticated: false, roles: [], passwordChangeRequired: false });
    void navigate("/login");
  }

  return <div className="flex min-h-screen flex-col bg-linear-to-br from-slate-100 to-(--club-accent)/20 text-slate-900">
    <header className="flex items-center gap-3 px-5 py-4 sm:px-8">
      {config?.logoUrl && <img src={config.logoUrl} alt="" className="h-10 w-10 rounded-lg object-contain" />}
      <span className="text-xl font-bold">{config?.clubName ?? t("app.name")}</span>
    </header>
    <main className="flex flex-1 items-center justify-center px-4 py-8">
      {offline ? <Alert>{t("status.offline")}</Alert> : session
        ? <AppRoutes session={session} refreshSession={refreshSession} passwordChanged={passwordChanged} initialPasswordChanged={initialPasswordChanged} signedOut={signOut} />
        : <p aria-live="polite">{t("status.loading")}</p>}
    </main>
    <footer className="flex justify-center gap-5 px-5 py-4 text-sm text-slate-600">
      {source && <a className="underline hover:no-underline" href={source.sourceUrl}>{t("footer.source")}</a>}
      {config?.imprintUrl && <a className="underline hover:no-underline" href={config.imprintUrl}>{t("footer.imprint")}</a>}
    </footer>
  </div>;
}
