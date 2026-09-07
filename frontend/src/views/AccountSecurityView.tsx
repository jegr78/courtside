import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError, type AccountSession } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { TextField } from "../components/TextField";

const RECENT_AUTH = "urn:courtside:error:recent-authentication-required";

export function AccountSecurityView({ passwordChanged, signedOut }: {
  passwordChanged: () => void;
  signedOut: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [failure, setFailure] = useState<string>();
  const [reauthenticationFailure, setReauthenticationFailure] = useState<string>();
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState<{
    action: () => Promise<void>;
    completed?: () => void;
  }>();

  useEffect(() => {
    void api.accountSessions().then(setSessions).catch((error) => setFailure(problemMessage(error, t)));
  }, [t]);

  async function run(action: () => Promise<void>, completed?: () => void) {
    setPending(true);
    setFailure(undefined);
    try {
      await action();
      if (completed) completed();
      else setSessions(await api.accountSessions());
    } catch (error) {
      if (error instanceof ApiError && error.problem?.type === RECENT_AUTH) {
        setReauthenticationFailure(undefined);
        setRetry({ action, completed });
      } else {
        setFailure(problemMessage(error, t));
      }
    } finally {
      setPending(false);
    }
  }

  async function proveAgain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("reauthentication-password");
    if (typeof password !== "string" || !retry) return;
    setPending(true);
    setReauthenticationFailure(undefined);
    try {
      await api.reauthenticate(password);
      const pendingAction = retry;
      await pendingAction.action();
      setRetry(undefined);
      if (pendingAction.completed) pendingAction.completed();
      else setSessions(await api.accountSessions());
    } catch (error) {
      setReauthenticationFailure(problemMessage(error, t));
    } finally {
      setPending(false);
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

  const date = (timestamp: string) => new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: "medium", timeStyle: "short"
  }).format(new Date(timestamp));

  return <section data-testid="account-security-view" className="surface-panel grid w-full max-w-3xl gap-8 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <header><h1 className="text-2xl font-bold">{t("accountSecurity.title")}</h1><p className="text-muted mt-2">{t("accountSecurity.description")}</p></header>
    {failure && <Alert testId="account-security-failure">{failure}</Alert>}
    <section className="grid gap-4">
      <h2 className="text-xl font-bold">{t("accountSecurity.sessions.title")}</h2>
      <ul className="grid gap-3">
        {sessions.map((session) => <li key={session.handle} className="grid gap-2 rounded-xl border p-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div id={`account-session-${session.handle}`}><strong>{t(`accountSecurity.browser.${session.browserFamily}`)}</strong>{session.current && <span className="ml-2">({t("accountSecurity.sessions.current")})</span>}
            <div className="text-muted text-sm">{t("accountSecurity.sessions.created", { date: date(session.createdAt) })}</div>
            <div className="text-muted text-sm">{t("accountSecurity.sessions.active", { date: date(session.lastActivityAt) })}</div></div>
          <Button variant={session.current ? "secondary" : "destructive"} disabled={pending} type="button"
            aria-describedby={`account-session-${session.handle}`}
            data-testid={session.current ? "end-current-session" : "end-other-session"}
            onClick={() => void run(() => api.endAccountSession(session.handle),
              session.current ? signedOut : undefined)}>
            {t("accountSecurity.sessions.end")}
          </Button>
        </li>)}
      </ul>
      <div><Button variant="destructive" disabled={pending} type="button" data-testid="end-all-sessions"
        onClick={() => void run(api.endOwnSessions, signedOut)}>{t("accountSecurity.sessions.endAll")}</Button></div>
    </section>
    {retry && <Modal labelledBy="account-reauthentication-title" closed={() => {
      setRetry(undefined);
      setReauthenticationFailure(undefined);
    }}>
      <form className="grid gap-4 rounded-xl border p-4" onSubmit={(event) => void proveAgain(event)}>
        <h2 id="account-reauthentication-title" className="text-xl font-bold">{t("accountSecurity.reauthenticateTitle")}</h2>
        <p>{t("accountSecurity.reauthenticate")}</p>
        {reauthenticationFailure && <Alert>{reauthenticationFailure}</Alert>}
        <TextField id="reauthentication-password" name="reauthentication-password" type="password" autoComplete="current-password" required label={t("auth.password")} />
        <div><Button variant="primary" disabled={pending} type="submit">{t("accountSecurity.continue")}</Button></div>
      </form>
    </Modal>}
    <form className="grid gap-4" onSubmit={(event) => void changePassword(event)}>
      <h2 className="text-xl font-bold">{t("accountSecurity.password.title")}</h2>
      <TextField id="current-password" name="current-password" type="password" autoComplete="current-password" required label={t("accountSecurity.password.current")} />
      <TextField id="new-password" name="new-password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required label={t("password.new")} />
      <TextField id="confirm-password" name="confirm-password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required label={t("password.confirm")} />
      <div><Button variant="primary" disabled={pending} type="submit">{t("password.submit")}</Button></div>
    </form>
  </section>;
}
