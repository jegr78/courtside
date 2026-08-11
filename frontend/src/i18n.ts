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
    "identity.login.rateLimited": "Zu viele Anmeldeversuche. Bitte warte und versuche es erneut.",
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
    "court.number": "Platz {{number}}",
    "week.title": "Platzbelegung",
    "week.previous": "Vorherige Woche",
    "week.next": "Nächste Woche",
    "week.previousShort": "Zurück",
    "week.nextShort": "Weiter",
    "week.time": "Zeit",
    "week.bookingCount_one": "{{count}} Belegung",
    "week.bookingCount_other": "{{count}} Belegungen",
    "week.closed": "An diesem Tag ist die Anlage geschlossen.",
    "week.available": "Frei",
    "booking.open": "{{court}} um {{time}} Uhr buchen",
    "booking.title": "Buchung am {{date}} um {{time}} Uhr",
    "booking.courts": "Plätze",
    "booking.card": "Buchungskarte",
    "booking.members": "Mitglieder",
    "booking.memberSearch": "Mitglied suchen",
    "booking.addMember": "{{name}} hinzufügen",
    "booking.removeMember": "{{name}} entfernen",
    "booking.guest": "Name des Gastes",
    "booking.guests": "Gäste",
    "booking.guestNumber": "Name des Gastes {{number}}",
    "booking.addGuest": "Gast hinzufügen",
    "booking.participantCard": "Teilnehmerkarte",
    "booking.participantCards": "Teilnehmerkarten",
    "booking.participantCardNumber": "Teilnehmerkarte {{number}}",
    "booking.addParticipantCard": "Teilnehmerkarte hinzufügen",
    "booking.none": "Keine",
    "booking.note": "Notiz",
    "booking.submit": "Jetzt buchen",
    "booking.close": "Schließen",
    "booking.cancelLabel": "{{label}}, Buchung stornieren",
    "booking.cancelTitle": "Buchung stornieren",
    "booking.cancelQuestion": "Soll die Buchung {{label}} storniert werden?",
    "booking.cancelConfirm": "Stornierung bestätigen",
    "booking.rule.openingHours.closed": "An diesem Tag ist die Anlage geschlossen.",
    "booking.rule.openingHours.outside": "Buchungen sind nur zwischen {{opensAt}} und {{closesAt}} Uhr möglich.",
    "booking.rule.slotGrid.misaligned": "Buchungen beginnen im {{slotMinutes}}-Minuten-Raster.",
    "booking.rule.slotGrid.duration": "Die Buchungsdauer muss ein Vielfaches von {{slotMinutes}} Minuten sein.",
    "booking.rule.advanceWindow.exceeded": "Du kannst höchstens {{maxDays}} Tage im Voraus buchen.",
    "booking.rule.maxOpenBookings.exceeded": "Du hast bereits {{current}} von {{limit}} möglichen offenen Buchungen.",
    "booking.rule.startsInPast": "Eine Buchung darf nicht in der Vergangenheit beginnen.",
    "booking.participants.slotCount": "Die Karte {{cardLabel}} erlaubt {{allowed}} Spieler; diese Buchung hat {{actual}}.",
    "booking.participants.notTracked": "Die Karte {{cardLabel}} erfasst keine Spieler.",
    "booking.participants.bookerUnknown": "Für diese Buchungskarte wird ein Konto mit hinterlegter Person benötigt.",
    "booking.participants.duplicate": "Ein Spieler kann nur einen Platz einer Buchung belegen.",
    "booking.participants.guestNotAllowed": "Die Karte {{cardLabel}} erlaubt keine Gäste.",
    "booking.participants.invalid": "Ein Teilnehmer muss entweder ein Mitglied oder ein namentlich genannter Gast sein.",
    "booking.participants.unknownCard": "Diese Teilnehmerkarte ist nicht verfügbar.",
    "booking.participants.cardUnavailable": "{{cardLabel}} ist zu dieser Zeit bereits vergeben. Der Verein hat insgesamt {{capacity}}.",
    "booking.participants.unknownPerson": "Ein Teilnehmer dieser Buchung ist keine bekannte Person.",
    "auth.logout": "Abmelden",
    "status.loading": "Courtside wird geladen …",
    "status.offline": "Courtside ist gerade nicht erreichbar. Prüfe deine Verbindung.",
    "error.generic": "Das hat nicht funktioniert. Bitte versuche es erneut.",
    "validation.Size": "Die Eingabe hat nicht die erlaubte Länge.",
    "footer.source": "Quellcode",
    "environment.uat": "UAT",
    "environment.performance": "Performance-Testumgebung",
    "environment.loading": "Build und Umgebung werden ermittelt",
    "environment.unavailable": "Build und Umgebung konnten nicht ermittelt werden",
    "build.unavailable": "Version nicht verfügbar",
    "build.about": "Über Courtside",
    "build.version": "Version",
    "build.commit": "Commit",
    "build.environment": "Umgebung",
    "build.copy": "Systeminformationen kopieren",
    "build.copied": "Kopiert",
    "build.close": "Schließen",
    "footer.imprint": "Impressum"
  } },
  en: { translation: {
    "app.name": "Courtside",
    "auth.signIn": "Sign in to Courtside",
    "auth.username": "Username",
    "auth.password": "Password",
    "auth.submit": "Sign in",
    "auth.failed": "The username or password is incorrect.",
    "identity.login.rateLimited": "Too many login attempts. Please wait and try again.",
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
    "court.number": "Court {{number}}",
    "week.title": "Court occupancy",
    "week.previous": "Previous week",
    "week.next": "Next week",
    "week.previousShort": "Back",
    "week.nextShort": "Next",
    "week.time": "Time",
    "week.bookingCount_one": "{{count}} booking",
    "week.bookingCount_other": "{{count}} bookings",
    "week.closed": "The facility is closed on this day.",
    "week.available": "Available",
    "booking.open": "Book {{court}} at {{time}}",
    "booking.title": "Booking on {{date}} at {{time}}",
    "booking.courts": "Courts",
    "booking.card": "Booking card",
    "booking.members": "Members",
    "booking.memberSearch": "Search members",
    "booking.addMember": "Add {{name}}",
    "booking.removeMember": "Remove {{name}}",
    "booking.guest": "Guest name",
    "booking.guests": "Guests",
    "booking.guestNumber": "Guest name {{number}}",
    "booking.addGuest": "Add guest",
    "booking.participantCard": "Participant card",
    "booking.participantCards": "Participant cards",
    "booking.participantCardNumber": "Participant card {{number}}",
    "booking.addParticipantCard": "Add participant card",
    "booking.none": "None",
    "booking.note": "Note",
    "booking.submit": "Book now",
    "booking.close": "Close",
    "booking.cancelLabel": "{{label}}, cancel booking",
    "booking.cancelTitle": "Cancel booking",
    "booking.cancelQuestion": "Cancel the {{label}} booking?",
    "booking.cancelConfirm": "Confirm cancellation",
    "booking.rule.openingHours.closed": "The facility is closed on this day.",
    "booking.rule.openingHours.outside": "Bookings are only possible between {{opensAt}} and {{closesAt}}.",
    "booking.rule.slotGrid.misaligned": "Bookings start on the {{slotMinutes}}-minute grid.",
    "booking.rule.slotGrid.duration": "The booking duration must be a multiple of {{slotMinutes}} minutes.",
    "booking.rule.advanceWindow.exceeded": "You can book at most {{maxDays}} days in advance.",
    "booking.rule.maxOpenBookings.exceeded": "You already have {{current}} of {{limit}} possible open bookings.",
    "booking.rule.startsInPast": "A booking cannot start in the past.",
    "booking.participants.slotCount": "The card {{cardLabel}} allows {{allowed}} players; this booking has {{actual}}.",
    "booking.participants.notTracked": "The card {{cardLabel}} does not record players.",
    "booking.participants.bookerUnknown": "This booking card requires an account with a person behind it.",
    "booking.participants.duplicate": "A player can only occupy one slot of a booking.",
    "booking.participants.guestNotAllowed": "The card {{cardLabel}} does not allow guests.",
    "booking.participants.invalid": "A participant must be either a member or a named guest.",
    "booking.participants.unknownCard": "This participant card is not available.",
    "booking.participants.cardUnavailable": "{{cardLabel}} is already taken at this time. The club has {{capacity}} in total.",
    "booking.participants.unknownPerson": "A participant of this booking is not a known person.",
    "auth.logout": "Sign out",
    "status.loading": "Loading Courtside …",
    "status.offline": "Courtside cannot be reached. Check your connection.",
    "error.generic": "That did not work. Please try again.",
    "validation.Size": "The input does not have the permitted length.",
    "footer.source": "Source code",
    "environment.uat": "UAT",
    "environment.performance": "Performance test environment",
    "environment.loading": "Build and environment are being identified",
    "environment.unavailable": "Build and environment could not be identified",
    "build.unavailable": "Version unavailable",
    "build.about": "About Courtside",
    "build.version": "Version",
    "build.commit": "Commit",
    "build.environment": "Environment",
    "build.copy": "Copy system information",
    "build.copied": "Copied",
    "build.close": "Close",
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
