import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export type SupportedLocale = "de" | "en";

const resources = {
  de: { translation: {
    "app.name": "Courtside",
    "auth.signIn": "Bei Courtside anmelden",
    "auth.username": "Benutzername",
    "auth.password": "Passwort",
    "auth.submit": "Anmelden",
    "auth.failed": "Benutzername oder Passwort ist nicht richtig.",
    "auth.expired": "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.",
    "password.title": "Einmalpasswort ersetzen",
    "password.description": "Lege ein dauerhaftes Passwort fest, bevor du Courtside verwendest.",
    "password.new": "Neues Passwort",
    "password.confirm": "Neues Passwort bestätigen",
    "password.submit": "Passwort speichern",
    "password.mismatch": "Die Passwörter stimmen nicht überein.",
    "password.tooShort": "Das Passwort muss mindestens 12 Zeichen enthalten.",
    "password.changed": "Das Passwort wurde geändert. Melde dich jetzt erneut an.",
    "home.welcome": "Willkommen, {{name}}",
    "home.roles": "Rollen: {{roles}}",
    "auth.logout": "Abmelden",
    "status.loading": "Courtside wird geladen …",
    "status.offline": "Courtside ist gerade nicht erreichbar. Prüfe deine Verbindung.",
    "error.generic": "Das hat nicht funktioniert. Bitte versuche es erneut.",
    "validation.Size": "Die Eingabe hat nicht die erlaubte Länge.",
    "footer.source": "Quellcode",
    "footer.imprint": "Impressum"
  } },
  en: { translation: {
    "app.name": "Courtside",
    "auth.signIn": "Sign in to Courtside",
    "auth.username": "Username",
    "auth.password": "Password",
    "auth.submit": "Sign in",
    "auth.failed": "The username or password is incorrect.",
    "auth.expired": "Your session has expired. Please sign in again.",
    "password.title": "Replace one-time password",
    "password.description": "Choose a permanent password before using Courtside.",
    "password.new": "New password",
    "password.confirm": "Confirm new password",
    "password.submit": "Save password",
    "password.mismatch": "The passwords do not match.",
    "password.tooShort": "The password must contain at least 12 characters.",
    "password.changed": "Your password was changed. Sign in again now.",
    "home.welcome": "Welcome, {{name}}",
    "home.roles": "Roles: {{roles}}",
    "auth.logout": "Sign out",
    "status.loading": "Loading Courtside …",
    "status.offline": "Courtside cannot be reached. Check your connection.",
    "error.generic": "That did not work. Please try again.",
    "validation.Size": "The input does not have the permitted length.",
    "footer.source": "Source code",
    "footer.imprint": "Legal notice"
  } }
};

export function supportedLocale(value?: string | null): SupportedLocale | undefined {
  const language = value?.toLowerCase().split("-")[0];
  return language === "de" || language === "en" ? language : undefined;
}

export function initialLocale(): SupportedLocale {
  const stored = explicitLocale();
  const browser = navigator.languages.map(supportedLocale).find(Boolean);
  return stored ?? browser ?? "de";
}

export function explicitLocale(): SupportedLocale | undefined {
  return supportedLocale(window.localStorage?.getItem("courtside.locale"));
}

export async function setLocale(locale: SupportedLocale): Promise<void> {
  window.localStorage?.setItem("courtside.locale", locale);
  await applyLocale(locale);
}

export async function applyAccountLocale(locale: SupportedLocale): Promise<void> {
  if (!explicitLocale()) {
    await applyLocale(locale);
  }
}

async function applyLocale(locale: SupportedLocale): Promise<void> {
  document.documentElement.lang = locale;
  await i18n.changeLanguage(locale);
}

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale(),
  fallbackLng: "de",
  interpolation: { escapeValue: false }
});

export default i18n;
