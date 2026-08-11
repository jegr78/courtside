import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api, type ClubConfig, type SessionStatus, type SourceOffer } from "./api/client";
import { Alert } from "./components/Alert";
import { BuildIdentity, EnvironmentMarker } from "./components/BuildIdentity";
import { Preferences } from "./components/Preferences";
import { applyAccountLocale, supportedLocale } from "./i18n";
import { HomeView } from "./views/HomeView";
import { InitialPasswordView } from "./views/InitialPasswordView";
import { LoginView } from "./views/LoginView";
import { MyBookingsPage } from "./views/MyBookingsPage";

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
  return <Routes>
    <Route path="/" element={<HomeView session={session} signedOut={() => signedOut?.()} />} />
    <Route path="/courts" element={<HomeView session={session} signedOut={() => signedOut?.()} />} />
    <Route path="/login" element={session.authenticated
      ? <Navigate to="/" replace />
      : <LoginView refreshSession={refreshSession} passwordChanged={passwordChanged} />} />
    <Route path="/my-bookings" element={session.authenticated
      ? <MyBookingsPage session={session} signedOut={() => signedOut?.()} />
      : <LoginView refreshSession={refreshSession} passwordChanged={passwordChanged} />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}

function applyBranding(config: ClubConfig) {
  document.title = config.clubName;
  document.documentElement.style.setProperty("--club-primary", config.primaryColor);
  document.documentElement.style.setProperty("--club-primary-text", contrastColor(config.primaryColor));
  document.documentElement.style.setProperty("--club-accent", config.accentColor);
}

function contrastColor(color: string): string {
  const shade = "#17211d";
  const line = "#fcfbf9";
  return contrastRatio(color, shade) >= contrastRatio(color, line) ? shade : line;
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function relativeLuminance(color: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function CourtsideMark() {
  return <svg viewBox="0 0 64 64" aria-hidden="true" data-testid="courtside-mark" className="h-10 w-10">
    <g fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
      <rect x="1.25" y="1.25" width="61.5" height="61.5" rx="11" ry="11" />
      <rect x="11" y="9" width="42" height="46" />
      <line x1="20" y1="9" x2="20" y2="55" />
      <line x1="20" y1="31" x2="53" y2="31" />
      <line x1="36.5" y1="9" x2="36.5" y2="31" />
    </g>
    <path d="M11 9h9v46h-9z" fill="currentColor" />
  </svg>;
}

export function App() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionStatus>();
  const [config, setConfig] = useState<ClubConfig>();
  const [source, setSource] = useState<SourceOffer>();
  const [identityStatus, setIdentityStatus] = useState<"loading" | "available" | "unavailable">("loading");
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
      api.source()
        .then((value) => {
          setSource(value);
          setIdentityStatus("available");
        })
        .catch(() => setIdentityStatus("unavailable"))
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

  return <div className="flex min-h-screen flex-col bg-(--cs-page) text-(--cs-text)">
    <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
      <div className="flex items-center gap-3">
        {config?.logoUrl ? <img src={config.logoUrl} alt="" data-testid="club-logo" className="h-10 w-10 rounded-lg object-contain" /> : <CourtsideMark />}
        <span className="text-xl font-bold">{config?.clubName ?? t("app.name")}</span>
      </div>
      <Preferences />
    </header>
    <EnvironmentMarker source={source} identityStatus={identityStatus} />
    <main className="flex flex-1 items-center justify-center px-4 py-8">
      {offline ? <Alert>{t("status.offline")}</Alert> : session
        ? <AppRoutes session={session} refreshSession={refreshSession} passwordChanged={passwordChanged} initialPasswordChanged={initialPasswordChanged} signedOut={signOut} />
        : <p aria-live="polite">{t("status.loading")}</p>}
    </main>
    <footer className="text-muted flex justify-center gap-5 px-5 py-4 text-sm">
      <BuildIdentity source={source} />
      {config?.imprintUrl && <a className="underline hover:no-underline" href={config.imprintUrl}>{t("footer.imprint")}</a>}
    </footer>
  </div>;
}
