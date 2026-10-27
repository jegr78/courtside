import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { setLocale, supportedLocale, type SupportedLocale } from "../i18n";
import { initialTheme, setTheme, type Theme } from "../theme";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { LocaleSelect } from "./LocaleSelect";
import { ScrollContinuation } from "./ScrollContinuation";
import { useScrollContinuation } from "./useScrollContinuation";

const controlClass = "form-control rounded-lg border px-3 py-2 text-sm font-semibold";

export function Preferences({ authenticated = false, username, supported, signedOut }: {
  authenticated?: boolean;
  username?: string;
  supported?: string[];
  signedOut: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [theme, updateTheme] = useState<Theme>(initialTheme);
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string>();
  const session = useRef(0);
  const panel = useRef<HTMLDivElement>(null);
  const { body, content, continues, measure: measureContinuation } = useScrollContinuation(open);
  const [panelHeight, setPanelHeight] = useState<number>();
  const locale = supportedLocale(i18n.resolvedLanguage) ?? i18n.resolvedLanguage ?? "";

  useLayoutEffect(() => {
    session.current += 1;
    setFailure(undefined);
  }, [authenticated, username]);

  // A short viewport scrolls the menu itself, so sign out stays reachable without moving the page.
  useLayoutEffect(() => {
    if (!open) return;
    const fit = () => {
      const top = panel.current?.getBoundingClientRect().top;
      if (top !== undefined) setPanelHeight(Math.max(0, window.innerHeight - top - 8));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [open]);

  function report(raisedDuring: number, message?: string) {
    if (session.current === raisedDuring) setFailure(message);
  }

  async function changeLocale(value: SupportedLocale) {
    const raisedDuring = session.current;
    let applied: boolean;
    try {
      applied = await setLocale(value);
    } catch {
      report(raisedDuring, t("preferences.languageUnavailable"));
      return;
    }
    if (!applied || !authenticated) return;
    try {
      await api.changeOwnLocale(value);
      report(raisedDuring);
    } catch (rejected) {
      report(raisedDuring, problemMessage(rejected, t));
    }
  }

  async function logout() {
    setFailure(undefined);
    const raisedDuring = session.current;
    try {
      await api.logout();
    } catch (rejected) {
      report(raisedDuring, problemMessage(rejected, t));
      return;
    }
    setOpen(false);
    signedOut();
  }

  function changeTheme(value: Theme) {
    updateTheme(value);
    setTheme(value);
  }

  return <div className="grid w-full justify-items-start gap-2 sm:w-auto sm:justify-items-end">
    {failure && <Alert testId="preferences-failure">{failure}</Alert>}
    <details className="relative min-w-0 max-w-full" open={open}>
      <summary data-testid="preferences-menu"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
        className="form-control flex max-w-full cursor-pointer list-none flex-wrap items-center gap-x-2 rounded-lg border px-3 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span className={authenticated ? "sr-only sm:not-sr-only sm:shrink-0" : undefined}>{t(authenticated ? "preferences.accountMenu" : "preferences.menu")}</span>{" "}
        {authenticated && <span data-testid="account-identity" className="min-w-0 break-all font-normal">{username ?? t("account.unavailable")}</span>}
      </summary>
      <div ref={panel} style={{ maxHeight: panelHeight }}
        className="surface-panel absolute left-0 z-30 mt-2 flex w-64 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border shadow-[0_20px_50px_var(--cs-shadow)] sm:left-auto sm:right-0">
        <div ref={body} data-testid="preferences-body" onScroll={measureContinuation} className="min-h-0 overflow-y-auto overscroll-contain">
          <div ref={content} className="grid gap-4 p-4 pb-1">
        <label className="grid gap-2 text-sm font-semibold" htmlFor="locale-preference">
          {t("preferences.language")}
          <LocaleSelect id="locale-preference" className={controlClass} value={locale} supported={supported} changed={(value) => void changeLocale(value)} />
        </label>
        <label className="grid gap-2 text-sm font-semibold" htmlFor="theme-preference">
          {t("preferences.theme")}
          <select id="theme-preference" className={controlClass} value={theme} onChange={(event) => changeTheme(event.target.value as Theme)}>
            <option value="dark">{t("preferences.dark")}</option>
            <option value="light">{t("preferences.light")}</option>
          </select>
        </label>
        {authenticated && <Link to="/account" data-testid="account-link"
          onClick={() => setOpen(false)} className="focus-ring rounded-lg border px-4 py-3 text-center font-semibold hover:brightness-90">
          {t("account.title")}
        </Link>}
        {authenticated && <Button variant="secondary" type="button" data-testid="logout" onClick={() => void logout()}>{t("auth.logout")}</Button>}
          </div>
        </div>
        <ScrollContinuation continues={continues} testId="preferences-continues" />
      </div>
    </details>
  </div>;
}
