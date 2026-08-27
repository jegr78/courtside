import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api, type ClubConfig, type SessionStatus, type SourceOffer } from "./api/client";
import { Alert } from "./components/Alert";
import { BuildIdentity, EnvironmentMarker } from "./components/BuildIdentity";
import { Preferences } from "./components/Preferences";
import { PrimaryNavigation } from "./components/PrimaryNavigation";
import { PwaLifecycle } from "./components/PwaLifecycle";
import { applyAccountLocale, supportedLocale } from "./i18n";
import { HomeView } from "./views/HomeView";
import { InitialPasswordView } from "./views/InitialPasswordView";
import { LoginView } from "./views/LoginView";
import { MyBookingsPage } from "./views/MyBookingsPage";
import { MyMessagesView } from "./views/MyMessagesView";
import { AdminAuditView } from "./views/AdminAuditView";
import { AdminMessagesView } from "./views/AdminMessagesView";
import { AdminConfigurationView } from "./views/AdminConfigurationView";
import { AdminFacilityView } from "./views/AdminFacilityView";
import { AdminMembershipTypesView } from "./views/AdminMembershipTypesView";
import { AdminImportView } from "./views/AdminImportView";
import { AdminPersonView } from "./views/AdminPersonView";
import { AdminRosterView } from "./views/AdminRosterView";

interface AppRoutesProps {
  session: SessionStatus;
  refreshSession: () => Promise<void>;
  passwordChanged?: boolean;
  initialPasswordChanged?: () => void;
  signedOut?: () => void;
  configurationChanged?: (config: ClubConfig) => void;
}

export function AppRoutes({ session, refreshSession, passwordChanged, initialPasswordChanged, signedOut, configurationChanged }: AppRoutesProps) {
  if (session.passwordChangeRequired) {
    return <Routes>
      <Route path="/initial-password" element={<InitialPasswordView changed={() => initialPasswordChanged?.()} />} />
      <Route path="*" element={<Navigate to="/initial-password" replace />} />
    </Routes>;
  }
  return <div className="flex w-full flex-col items-center gap-4">
    <PrimaryNavigation session={session} signedOut={() => signedOut?.()} />
    <Routes>
    <Route path="/" element={<HomeView session={session} />} />
    <Route path="/courts" element={<HomeView session={session} />} />
    <Route path="/login" element={session.authenticated
      ? <Navigate to="/" replace />
      : <LoginView refreshSession={refreshSession} passwordChanged={passwordChanged} />} />
    <Route path="/my-bookings" element={session.authenticated
      ? <MyBookingsPage session={session} />
      : <Navigate to="/login" replace />} />
    <Route path="/my-messages" element={session.authenticated
      ? <MyMessagesView />
      : <Navigate to="/login" replace />} />
    <Route path="/admin/configuration" element={session.roles.includes("ADMIN")
      ? <AdminConfigurationView configurationChanged={(changed) => configurationChanged?.(changed)} />
      : <Navigate to="/" replace />} />
    <Route path="/admin/facility" element={session.roles.includes("ADMIN")
      ? <AdminFacilityView />
      : <Navigate to="/" replace />} />
    <Route path="/admin/roster" element={session.roles.includes("ADMIN")
      ? <AdminRosterView />
      : <Navigate to="/" replace />} />
    <Route path="/admin/roster/:personId" element={session.roles.includes("ADMIN")
      ? <AdminPersonView />
      : <Navigate to="/" replace />} />
    <Route path="/admin/membership-types" element={session.roles.includes("ADMIN")
      ? <AdminMembershipTypesView />
      : <Navigate to="/" replace />} />
    <Route path="/admin/import" element={session.roles.includes("ADMIN")
      ? <AdminImportView />
      : <Navigate to="/" replace />} />
    <Route path="/admin/audit" element={session.roles.includes("ADMIN")
      ? <AdminAuditView />
      : <Navigate to="/" replace />} />
    <Route path="/admin/messages" element={session.roles.includes("ADMIN")
      ? <AdminMessagesView />
      : <Navigate to="/" replace />} />
    <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </div>;
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

  // The account's language is applied before the session is published, so the signed-in navigation
  // is painted once instead of moving its links out from under whoever is already reaching for one.
  const refreshSession = useCallback(async () => {
    const current = await api.session();
    const accountLocale = supportedLocale(current.locale);
    if (accountLocale) {
      await applyAccountLocale(accountLocale).catch(() => undefined);
    }
    setSession(current);
    setOffline(false);
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

  useEffect(() => {
    const wentOffline = () => setOffline(true);
    const cameOnline = () => void refreshSession().catch(() => setOffline(true));
    window.addEventListener("offline", wentOffline);
    window.addEventListener("online", cameOnline);
    return () => {
      window.removeEventListener("offline", wentOffline);
      window.removeEventListener("online", cameOnline);
    };
  }, [refreshSession]);

  function initialPasswordChanged() {
    flushSync(() => {
      setPasswordChanged(true);
      setSession({ authenticated: false, roles: [], passwordChangeRequired: false });
    });
    void navigate("/login");
  }

  // The session has to be gone before the route is chosen: signing out from a role-guarded page
  // would otherwise be sent home by that page's own redirect before this one is applied.
  function signOut() {
    flushSync(() => setSession({ authenticated: false, roles: [], passwordChangeRequired: false }));
    void navigate("/login");
  }

  function configurationChanged(changed: ClubConfig) {
    setConfig(changed);
    applyBranding(changed);
  }

  return <div className="flex min-h-screen flex-col bg-(--cs-page) text-(--cs-text)">
    <PwaLifecycle />
    <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
      <div className="flex items-center gap-3">
        {config?.logoUrl ? <img src={config.logoUrl} alt="" data-testid="club-logo" className="h-10 w-10 rounded-lg object-contain" /> : <CourtsideMark />}
        <span data-testid="club-brand-name" className="text-xl font-bold">{config?.clubName ?? t("app.name")}</span>
      </div>
      <Preferences authenticated={session?.authenticated ?? false} supported={config?.supportedLocales} />
    </header>
    <EnvironmentMarker source={source} identityStatus={identityStatus} />
    <main className="flex flex-1 items-center justify-center px-4 py-8">
      {offline ? <div data-testid="offline-status"><Alert>{t("status.offline")}</Alert></div> : session
        ? <AppRoutes session={session} refreshSession={refreshSession} passwordChanged={passwordChanged} initialPasswordChanged={initialPasswordChanged} signedOut={signOut} configurationChanged={configurationChanged} />
        : <p role="status">{t("status.loading")}</p>}
    </main>
    <footer className="text-muted flex flex-wrap justify-center gap-x-5 gap-y-2 px-5 py-4 text-sm">
      <BuildIdentity source={source} />
      {config?.imprintUrl && <a data-testid="footer-imprint" className="underline hover:no-underline" href={config.imprintUrl}>{t("footer.imprint")}</a>}
      {config?.privacyUrl && <a data-testid="footer-privacy" className="underline hover:no-underline" href={config.privacyUrl}>{t("footer.privacy")}</a>}
    </footer>
  </div>;
}
