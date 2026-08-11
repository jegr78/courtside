import { useState } from "react";
import { useTranslation } from "react-i18next";
import { setLocale, type SupportedLocale } from "../i18n";
import { initialTheme, setTheme, type Theme } from "../theme";

const controlClass = "form-control rounded-lg border px-3 py-2 text-sm font-semibold";

export function Preferences() {
  const { t, i18n } = useTranslation();
  const [theme, updateTheme] = useState<Theme>(initialTheme);
  const locale = i18n.resolvedLanguage === "en" ? "en" : "de";

  function changeTheme(value: Theme) {
    updateTheme(value);
    setTheme(value);
  }

  return <div className="flex flex-wrap justify-end gap-2">
    <label className="sr-only" htmlFor="locale-preference">{t("preferences.language")}</label>
    <select id="locale-preference" className={controlClass} value={locale} onChange={(event) => void setLocale(event.target.value as SupportedLocale)}>
      <option value="de">Deutsch</option>
      <option value="en">English</option>
    </select>
    <label className="sr-only" htmlFor="theme-preference">{t("preferences.theme")}</label>
    <select id="theme-preference" className={controlClass} value={theme} onChange={(event) => changeTheme(event.target.value as Theme)}>
      <option value="dark">{t("preferences.dark")}</option>
      <option value="light">{t("preferences.light")}</option>
    </select>
  </div>;
}
