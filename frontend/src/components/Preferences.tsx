import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
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
  signedOut?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [theme, updateTheme] = useState<Theme>(initialTheme);
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string>();
  const locale = supportedLocale(i18n.resolvedLanguage) ?? i18n.resolvedLanguage ?? "";

  // Stored on the account rather than in the browser, so the next message the instance sends
  // arrives in the language the member reads.
  async function changeLocale(value: SupportedLocale) {
    await setLocale(value);
    if (!authenticated) return;
    try {
      await api.changeOwnLocale(value);
      setFailure(undefined);
    } catch (rejected) {
      setFailure(problemMessage(rejected, t));
    }
  }

  // Signing out belongs to the account, beside language and appearance, rather than standing on
  // every page as the largest and most colourful control on it.
  async function logout() {
    setFailure(undefined);
    try {
      await api.logout();
      setOpen(false);
      signedOut?.();
    } catch (rejected) {
      setFailure(problemMessage(rejected, t));
    }
  }

  function changeTheme(value: Theme) {
    updateTheme(value);
    setTheme(value);
  }

  return <div className="grid justify-items-end gap-2">
    {failure && <Alert testId="preferences-failure">{failure}</Alert>}
    <details className="relative" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary data-testid="preferences-menu" className="form-control cursor-pointer list-none rounded-lg border px-3 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
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
