import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import de from "./locales/de";

type Translation = Record<keyof typeof de, string>;

// The default language ships with the entry, so a bundle that fails to arrive never leaves keys on screen.
export const localeBundles = {
  de: () => Promise.resolve<Translation>(de),
  en: () => import("./locales/en").then((loaded) => loaded.default)
};

// Derived from the bundles above, so a language arrives by being translated and by nothing else.
export type SupportedLocale = keyof typeof localeBundles;

export const shippedLocales = Object.keys(localeBundles) as SupportedLocale[];

export function supportedLocale(value?: string | null): SupportedLocale | undefined {
  const language = value?.toLowerCase().split("-")[0];
  return shippedLocales.find((tag) => tag === language);
}

// What the instance answers with wins, because it is the API that refuses an unknown language.
export function availableLocales(served?: string[]): SupportedLocale[] {
  return served ? shippedLocales.filter((tag) => served.includes(tag)) : shippedLocales;
}

export function initialLocale(): SupportedLocale {
  return explicitLocale() ?? "de";
}

export function explicitLocale(): SupportedLocale | undefined {
  return supportedLocale(window.localStorage?.getItem("courtside.locale"));
}

// Resolves false when a later choice overtook this one while its bundle was still arriving.
export async function setLocale(locale: SupportedLocale): Promise<boolean> {
  const applied = await applyLocale(locale);
  if (applied) window.localStorage?.setItem("courtside.locale", locale);
  return applied;
}

export async function applyAccountLocale(locale: SupportedLocale): Promise<void> {
  if (!explicitLocale()) {
    await applyLocale(locale);
  }
}

let latestLocaleRequest = 0;

async function applyLocale(locale: SupportedLocale): Promise<boolean> {
  const request = ++latestLocaleRequest;
  if (!i18n.hasResourceBundle(locale, "translation")) {
    i18n.addResourceBundle(locale, "translation", await localeBundles[locale]());
  }
  if (request !== latestLocaleRequest) return false;
  document.documentElement.lang = locale;
  await i18n.changeLanguage(locale);
  return true;
}

document.documentElement.lang = "de";

void i18n.use(initReactI18next).init({
  resources: { de: { translation: de } },
  lng: "de",
  fallbackLng: "de",
  interpolation: { escapeValue: false }
});

// Settles either way: a language that cannot be fetched leaves the page in the default one.
export const localeReady: Promise<void> = applyLocale(initialLocale()).then(() => undefined, () => undefined);

export default i18n;
