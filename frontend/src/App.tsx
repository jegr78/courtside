import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AccountRecoveryView } from "./views/AccountRecoveryView";
import { api, type ClubConfig, type SessionStatus, type SourceOffer } from "./api/client";
import { Alert } from "./components/Alert";
import { BuildIdentity, EnvironmentMarker } from "./components/BuildIdentity";
import { Preferences } from "./components/Preferences";
import { PrimaryNavigation } from "./components/PrimaryNavigation";
import { PwaLifecycle } from "./components/PwaLifecycle";
import { UnsavedChangesProvider } from "./unsaved/UnsavedChangesProvider";
import { UnsavedChangesGuard } from "./unsaved/UnsavedChangesGuard";
import { useClubConfiguration } from "./club/registry";
import { brandContrast } from "./brandColor";
import { applyAccountLocale, supportedLocale } from "./i18n";
import {
  clearPersonalBookingsOfflineData, listenForOtherClientSessionChanges, offlineMemberSession
} from "./offlineBookings";
import { lazySurface } from "./navigation/lazySurface";
import { HomeView } from "./views/HomeView";
import { InitialPasswordView } from "./views/InitialPasswordView";
import { LoginView } from "./views/LoginView";
import { MyBookingsPage } from "./views/MyBookingsPage";
import { MyMessagesView } from "./views/MyMessagesView";
import { AccountSecurityView } from "./views/AccountSecurityView";

const DEFAULT_DOCUMENTATION_URL = "https://jegr78.github.io/courtside/";

const AdminRoutes = lazySurface(() => import("./views/AdminRoutes"));

interface AppRoutesProps {
  session: SessionStatus;
  refreshSession: () => Promise<void>;
  passwordChanged?: boolean;
  initialPasswordChanged?: () => void;
  signedOut?: () => void;
  configurationChanged?: (config: ClubConfig) => void;
  clubName?: string;
  offline?: boolean;
}

export function AppRoutes({ session, refreshSession, passwordChanged, initialPasswordChanged, signedOut,
  configurationChanged, clubName, offline = false }: AppRoutesProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const administrative = pathname === "/admin" || pathname.startsWith("/admin/");

  if (session.passwordChangeRequired) {
    return <Routes>
      <Route path="/initial-password" element={<InitialPasswordView changed={() => initialPasswordChanged?.()} />} />
      <Route path="*" element={<Navigate to="/initial-password" replace />} />
    </Routes>;
  }
  return <UnsavedChangesProvider>
    <div className="flex w-full flex-col items-center gap-4">
    <UnsavedChangesGuard />
    {!administrative && <PrimaryNavigation session={session} />}
    <Routes>
    <Route path="/" element={<HomeView session={session} clubName={clubName} offline={offline} />} />
    <Route path="/courts" element={<HomeView session={session} clubName={clubName} offline={offline} />} />
    <Route path="/account-recovery" element={session.authenticated
      ? <Navigate to="/" replace />
      : <AccountRecoveryView />} />
    <Route path="/login" element={session.authenticated
      ? <Navigate to={passwordChanged && session.roles.includes("ADMIN") ? "/admin" : "/"} replace />
      : <LoginView refreshSession={refreshSession} passwordChanged={passwordChanged} />} />
    <Route path="/my-bookings" element={session.authenticated
      ? <MyBookingsPage session={session} offline={offline} />
      : <Navigate to="/login" replace />} />
    <Route path="/my-messages" element={session.authenticated
      ? <MyMessagesView />
      : <Navigate to="/login" replace />} />
    <Route path="/account/security" element={session.authenticated
      ? <AccountSecurityView passwordChanged={() => initialPasswordChanged?.()}
        signedOut={() => signedOut?.()} />
      : <Navigate to="/login" replace />} />
    {/* The role is asked once for the whole surface rather than once per destination. */}
    <Route path="/admin/*" element={session.roles.includes("ADMIN")
      ? <Suspense fallback={<p role="status">{t("status.loading")}</p>}>
        <AdminRoutes configurationChanged={(changed) => configurationChanged?.(changed)} />
      </Suspense>
      : <Navigate to="/" replace />} />
    <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </div>
  </UnsavedChangesProvider>;
}

function applyBranding(config: ClubConfig) {
  document.title = config.clubName;
  document.documentElement.style.setProperty("--club-primary", config.primaryColor);
  document.documentElement.style.setProperty("--club-primary-text", contrastColor(config.primaryColor));
  document.documentElement.style.setProperty("--club-accent", config.accentColor);
  applyTabIcon(config.logoUrl ?? "/icon.svg");
  applyMeta("theme-color", config.primaryColor);
  applyMeta("apple-mobile-web-app-title", config.installedAppName ?? config.clubName);
}

function applyMeta(name: string, content: string) {
  let meta = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = name;
    document.head.appendChild(meta);
  }
  meta.content = content;
}

function applyTabIcon(href: string) {
  let icon = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!icon) {
    icon = document.createElement("link");
    icon.rel = "icon";
    document.head.appendChild(icon);
  }
  icon.removeAttribute("type");
  icon.setAttribute("href", href);
}

function contrastColor(color: string): string {
  return brandContrast(color)?.textColor ?? "#17211d";
}

function CourtsideMark({ testId = "courtside-mark", className = "h-10 w-10" }: { testId?: string; className?: string }) {
  return <svg viewBox="0 0 64 64" aria-hidden="true" data-testid={testId} className={className}>
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
  const { club, changed: configurationChanged } = useClubConfiguration();
  const [session, setSession] = useState<SessionStatus>();
  const [source, setSource] = useState<SourceOffer>();
  const [identityStatus, setIdentityStatus] = useState<"loading" | "available" | "unavailable">("loading");
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const sessionInvalidations = useRef(0);

  // The account's language is applied before the session is published, so the signed-in navigation
  // is painted once instead of moving its links out from under whoever is already reaching for one.
  const refreshSession = useCallback(async () => {
    const requestedBefore = sessionInvalidations.current;
    const current = await api.session();
    if (requestedBefore !== sessionInvalidations.current) return;
    const accountLocale = supportedLocale(current.locale);
    if (accountLocale) {
      await applyAccountLocale(accountLocale).catch(() => undefined);
    }
    if (requestedBefore !== sessionInvalidations.current) return;
    if (!current.authenticated) await clearPersonalBookingsOfflineData();
    if (requestedBefore !== sessionInvalidations.current) return;
    setSession(current);
    setOffline(false);
  }, []);

  useEffect(() => {
    const unauthenticated = () => {
      sessionInvalidations.current += 1;
      setSession({ authenticated: false, roles: [], passwordChangeRequired: false });
      void navigate("/login");
    };
    const startupInvalidations = sessionInvalidations.current;
    void Promise.all([
      refreshSession().catch(async () => {
        setOffline(true);
        const restored = await offlineMemberSession()
          ?? { authenticated: false, roles: [], passwordChangeRequired: false };
        if (startupInvalidations === sessionInvalidations.current) setSession(restored);
      }),
      api.source()
        .then((value) => {
          setSource(value);
          setIdentityStatus("available");
        })
        .catch(() => setIdentityStatus("unavailable"))
    ]);
    const stopListeningForSessionChanges = listenForOtherClientSessionChanges(unauthenticated);
    window.addEventListener("courtside:unauthenticated", unauthenticated);
    return () => {
      stopListeningForSessionChanges();
      window.removeEventListener("courtside:unauthenticated", unauthenticated);
    };
  }, [navigate, refreshSession]);

  // Before the paint, not after it: the club's colours would otherwise show one frame of the
  // stylesheet's own.
  useLayoutEffect(() => {
    if (club) applyBranding(club);
  }, [club]);

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
    sessionInvalidations.current += 1;
    flushSync(() => {
      setPasswordChanged(true);
      setSession({ authenticated: false, roles: [], passwordChangeRequired: false });
    });
    void navigate("/login");
  }

  // The session has to be gone before the route is chosen: signing out from a role-guarded page
  // would otherwise be sent home by that page's own redirect before this one is applied.
  function signOut() {
    sessionInvalidations.current += 1;
    flushSync(() => setSession({ authenticated: false, roles: [], passwordChangeRequired: false }));
    void navigate("/login");
  }

  const authenticated = session?.authenticated ?? false;

  return <div className="flex min-h-screen flex-col bg-(--cs-page) text-(--cs-text)">
    <PwaLifecycle />
    <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
      <div className="flex items-center gap-3">
        {club?.logoUrl ? <img src={club.logoUrl} alt="" data-testid="club-logo" className="h-10 w-10 rounded-lg object-contain" /> : <CourtsideMark />}
        <span data-testid="club-brand-name" className="text-xl font-bold">{club?.clubName ?? t("app.name")}</span>
      </div>
      <Preferences authenticated={authenticated} supported={club?.supportedLocales} signedOut={signOut} />
    </header>
    <EnvironmentMarker source={source} identityStatus={identityStatus} />
    <main className="flex flex-1 items-start justify-center px-4 py-8">
      <div className="flex w-full flex-col items-center gap-4">
      {offline && <div data-testid="offline-status" className="w-full max-w-7xl"><Alert tone="warning">{t("status.offline")}</Alert></div>}
      {session
        ? <AppRoutes session={session} refreshSession={refreshSession} passwordChanged={passwordChanged}
          initialPasswordChanged={initialPasswordChanged} signedOut={signOut}
          configurationChanged={configurationChanged} clubName={club?.clubName} offline={offline} />
        : <p role="status">{t("status.loading")}</p>}
      </div>
    </main>
    <footer className="text-muted flex flex-wrap justify-center gap-x-5 gap-y-2 px-5 pt-4 pb-[max(6rem,calc(4rem+env(safe-area-inset-bottom)))] text-sm sm:pb-4">
      <span data-testid="footer-product-identity" className="flex items-center gap-2 font-semibold">
        <CourtsideMark testId="footer-product-mark" className="h-6 w-6" />
        {t("app.name")}
      </span>
      <BuildIdentity source={source} />
      <a data-testid="footer-documentation" className="underline hover:no-underline"
         href={club?.documentationUrl || DEFAULT_DOCUMENTATION_URL}>{t("footer.documentation")}</a>
      {club?.imprintUrl && <a data-testid="footer-imprint" className="underline hover:no-underline" href={club.imprintUrl}>{t("footer.imprint")}</a>}
      {club?.privacyUrl && <a data-testid="footer-privacy" className="underline hover:no-underline" href={club.privacyUrl}>{t("footer.privacy")}</a>}
    </footer>
  </div>;
}
