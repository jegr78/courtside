import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError, type AccountSession } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { LoadFailure } from "../components/LoadFailure";
import { Modal } from "../components/Modal";
import { TextField } from "../components/TextField";
import { useClubConfiguration } from "../club/registry";
import { MfaSettings } from "./MfaSettings";
import { ReauthenticationCode } from "../components/ReauthenticationCode";
import { reauthenticateForm } from "../security/reauthentication";
import { formatDateTime } from "../time/clubZone";

const RECENT_AUTH = "urn:courtside:error:recent-authentication-required";

export function AccountSecurityView({ passwordChanged, signedOut, embedded = false, focusRequested = false, mfaEnabled, username }: {
  mfaEnabled?: boolean;
  username?: string;
  passwordChanged: () => void;
  signedOut: (preserveRecoveryCodes?: boolean) => void;
  embedded?: boolean;
  focusRequested?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { club, error: clubError, load: loadClub } = useClubConfiguration();
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [failure, setFailure] = useState<string>();
  const [reauthenticationFailure, setReauthenticationFailure] = useState<string>();
  const [pending, setPending] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const actionVersion = useRef(0);
  const proofVersion = useRef(0);
  const Heading = embedded ? "h2" : "h1";
  const Subheading = embedded ? "h3" : "h2";
  const [retry, setRetry] = useState<{
    action: () => Promise<void>;
    completed?: () => void;
  }>();

  useEffect(() => {
    void api.accountSessions().then(setSessions).catch((error) => setFailure(problemMessage(error, t)));
  }, [t]);

  useLayoutEffect(() => () => { actionVersion.current += 1; }, []);

  function isCurrent(version: number) { return actionVersion.current === version; }

  useLayoutEffect(() => {
    if (!focusRequested) return;
    heading.current?.scrollIntoView?.({ block: "start" });
    heading.current?.focus({ preventScroll: true });
  }, [focusRequested]);

  async function run(action: () => Promise<void>, completed?: () => void) {
    const version = actionVersion.current;
    setPending(true);
    setFailure(undefined);
    try {
      await action();
      if (!isCurrent(version)) return;
      if (completed) completed();
      else setSessions(await api.accountSessions());
    } catch (error) {
      if (!isCurrent(version)) return;
      if (error instanceof ApiError && error.problem?.type === RECENT_AUTH) {
        setReauthenticationFailure(undefined);
        setRetry({ action, completed });
      } else {
        setFailure(problemMessage(error, t));
      }
    } finally {
      if (isCurrent(version)) setPending(false);
    }
  }

  async function proveAgain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("reauthentication-password");
    if (typeof password !== "string" || !retry) return;
    const version = actionVersion.current;
    const proof = proofVersion.current;
    event.currentTarget.querySelector<HTMLInputElement>("#reauthentication-password")?.focus();
    setPending(true);
    setReauthenticationFailure(undefined);
    try {
      await reauthenticateForm(event.currentTarget, password);
      if (!isCurrent(version) || proofVersion.current !== proof) return;
      const pendingAction = retry;
      await pendingAction.action();
      if (!isCurrent(version)) return;
      if (proofVersion.current === proof) setRetry(undefined);
      if (pendingAction.completed) pendingAction.completed();
      else setSessions(await api.accountSessions());
    } catch (error) {
      if (isCurrent(version) && proofVersion.current === proof) setReauthenticationFailure(problemMessage(error, t));
    } finally {
      if (isCurrent(version) && proofVersion.current === proof) setPending(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const current = data.get("current-password");
    const replacement = data.get("new-password");
    const confirmation = data.get("confirm-password");
    if (typeof current !== "string" || typeof replacement !== "string" || typeof confirmation !== "string") return;
    if (replacement.length < 12) {
      setFailure(t("password.tooShort"));
      return;
    }
    if (replacement !== confirmation) {
      setFailure(t("password.mismatch"));
      return;
    }
    await run(() => api.changeOwnPassword(current, replacement), passwordChanged);
  }

  return <section data-testid="account-security-view" className="surface-panel grid w-full max-w-3xl gap-8 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <header><Heading ref={heading} tabIndex={-1} data-testid="account-security-title"
      className="focus-ring scroll-mt-4 rounded text-2xl font-bold">{t("accountSecurity.title")}</Heading><p className="text-muted mt-2">{t("accountSecurity.description")}</p></header>
    {failure && <Alert testId="account-security-failure">{failure}</Alert>}
    {mfaEnabled !== undefined && <MfaSettings username={username} pending={pending} run={run} signedOut={signedOut} />}
    <section className="grid gap-4">
      <Subheading className="text-xl font-bold">{t("accountSecurity.sessions.title")}</Subheading>
      {clubError ? <LoadFailure message={clubError} retry={loadClub} /> : !club && <p role="status">{t("status.loading")}</p>}
      <ul className="grid gap-3">
        {sessions.map((session) => <li key={session.handle} className="grid gap-2 rounded-xl border p-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div id={`account-session-${session.handle}`}><strong>{t(`accountSecurity.browser.${session.browserFamily}`)}</strong>{session.current && <span className="ml-2">({t("accountSecurity.sessions.current")})</span>}
            {club && <div className="text-muted text-sm">{t("accountSecurity.sessions.created", { date: formatDateTime(session.createdAt, i18n.resolvedLanguage ?? "de", club.timeZone) })}</div>}
            {club && <div className="text-muted text-sm">{t("accountSecurity.sessions.active", { date: formatDateTime(session.lastActivityAt, i18n.resolvedLanguage ?? "de", club.timeZone) })}</div>}</div>
          <Button variant={session.current ? "secondary" : "destructive"} disabled={pending} type="button"
            aria-describedby={`account-session-${session.handle}`}
            data-testid={session.current ? "end-current-session" : "end-other-session"}
            onClick={() => void run(() => api.endAccountSession(session.handle, session.current),
              session.current ? signedOut : undefined)}>
            {t("accountSecurity.sessions.end")}
          </Button>
        </li>)}
      </ul>
      <div><Button variant="destructive" disabled={pending} type="button" data-testid="end-all-sessions"
        onClick={() => void run(api.endOwnSessions, signedOut)}>{t("accountSecurity.sessions.endAll")}</Button></div>
    </section>
    {retry && <Modal labelledBy="account-reauthentication-title" closed={() => {
      proofVersion.current += 1;
      setPending(false);
      setRetry(undefined);
      setReauthenticationFailure(undefined);
    }}>
      <form className="grid gap-4 rounded-xl border p-4" onSubmit={(event) => void proveAgain(event)}>
        <h2 id="account-reauthentication-title" className="text-xl font-bold">{t("accountSecurity.reauthenticateTitle")}</h2>
        <p>{t("accountSecurity.reauthenticate")}</p>
        {reauthenticationFailure && <Alert>{reauthenticationFailure}</Alert>}
        <TextField id="reauthentication-password" name="reauthentication-password" type="password" autoComplete="current-password" required label={t("auth.password")} />
        <ReauthenticationCode required={mfaEnabled} />
        <div><Button variant="primary" disabled={pending} type="submit" data-testid="reauthentication-submit">{t("accountSecurity.continue")}</Button></div>
      </form>
    </Modal>}
    <form className="grid gap-4" onSubmit={(event) => void changePassword(event)}>
      <Subheading className="text-xl font-bold">{t("accountSecurity.password.title")}</Subheading>
      <TextField id="current-password" name="current-password" data-testid="current-password" type="password" autoComplete="current-password" required label={t("accountSecurity.password.current")} />
      <TextField id="new-password" name="new-password" data-testid="new-password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required label={t("password.new")} />
      <TextField id="confirm-password" name="confirm-password" data-testid="confirm-password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required label={t("password.confirm")} />
      <div><Button variant="primary" data-testid="password-submit" disabled={pending} type="submit">{t("password.submit")}</Button></div>
    </form>
  </section>;
}
