import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { setLocale, supportedLocale, type SupportedLocale } from "../i18n";
import { initialTheme, setTheme, type Theme } from "../theme";
import { LocaleSelect } from "./LocaleSelect";

const controlClass = "form-control rounded-lg border px-3 py-2 text-sm font-semibold";

export function Preferences({ authenticated = false, supported }: {
  authenticated?: boolean;
  supported?: string[];
}) {
  const { t, i18n } = useTranslation();
  const [theme, updateTheme] = useState<Theme>(initialTheme);
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

  function changeTheme(value: Theme) {
    updateTheme(value);
    setTheme(value);
  }

  return <div className="flex flex-wrap items-center justify-end gap-2">
    {failure && <span data-testid="locale-not-stored" role="status" className="text-sm">{failure}</span>}
    <label className="sr-only" htmlFor="locale-preference">{t("preferences.language")}</label>
    <LocaleSelect id="locale-preference" className={controlClass} value={locale} supported={supported} changed={(value) => void changeLocale(value)} />
    <label className="sr-only" htmlFor="theme-preference">{t("preferences.theme")}</label>
    <select id="theme-preference" className={controlClass} value={theme} onChange={(event) => changeTheme(event.target.value as Theme)}>
      <option value="dark">{t("preferences.dark")}</option>
      <option value="light">{t("preferences.light")}</option>
    </select>
  </div>;
}
