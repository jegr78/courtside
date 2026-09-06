import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { setLocale, supportedLocale, type SupportedLocale } from "../i18n";
import { initialTheme, setTheme, type Theme } from "../theme";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { LocaleSelect } from "./LocaleSelect";

const controlClass = "form-control rounded-lg border px-3 py-2 text-sm font-semibold";

export function Preferences({ authenticated = false, supported, signedOut }: {
  authenticated?: boolean;
  supported?: string[];
  signedOut: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [theme, updateTheme] = useState<Theme>(initialTheme);
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string>();
  const session = useRef(0);
  const locale = supportedLocale(i18n.resolvedLanguage) ?? i18n.resolvedLanguage ?? "";

  // A message belongs to the session that raised it: the next one starts without it, and a request
  // answering after the change no longer writes onto it.
  useLayoutEffect(() => {
    session.current += 1;
    setFailure(undefined);
  }, [authenticated]);

  function report(raisedDuring: number, message?: string) {
    if (session.current === raisedDuring) setFailure(message);
  }

  // Stored on the account rather than in the browser, so the next message the instance sends
  // arrives in the language the member reads.
  async function changeLocale(value: SupportedLocale) {
    await setLocale(value);
    if (!authenticated) return;
    const raisedDuring = session.current;
    try {
      await api.changeOwnLocale(value);
      report(raisedDuring);
    } catch (rejected) {
      report(raisedDuring, problemMessage(rejected, t));
    }
  }

  // Signing out belongs to the account, beside language and appearance, rather than standing on
  // every page as the largest and most colourful control on it.
  async function logout() {
    setFailure(undefined);
    const raisedDuring = session.current;
    try {
      await api.logout();
    } catch (rejected) {
      // A session the instance has already ended refuses the request that would have ended it.
      if (!(rejected instanceof ApiError) || rejected.status !== 401) {
        report(raisedDuring, problemMessage(rejected, t));
        return;
      }
    }
    setOpen(false);
    signedOut();
  }

  function changeTheme(value: Theme) {
    updateTheme(value);
    setTheme(value);
  }

  return <div className="grid justify-items-end gap-2">
    {failure && <Alert testId="preferences-failure">{failure}</Alert>}
    <details className="relative" open={open}>
      <summary data-testid="preferences-menu"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
        className="form-control cursor-pointer list-none rounded-lg border px-3 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        {t(authenticated ? "preferences.accountMenu" : "preferences.menu")}
      </summary>
      <div className="surface-panel absolute right-0 z-30 mt-2 grid w-64 max-w-[calc(100vw-2rem)] gap-4 rounded-xl border p-4 shadow-[0_20px_50px_var(--cs-shadow)]">
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
        {authenticated && <Button variant="secondary" type="button" data-testid="logout" onClick={() => void logout()}>{t("auth.logout")}</Button>}
      </div>
    </details>
  </div>;
}
