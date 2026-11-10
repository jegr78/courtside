import type { ReactNode } from "react";
import type { ClubConfig } from "../api/client";
import { ClubConfigurationContext } from "../club/registry";
import { rememberFractionDigits } from "../money";

const exampleClub: ClubConfig = {
  clubName: "Example Tennis Club",
  primaryColor: "#b85c38",
  accentColor: "#d7e24b",
  defaultLocale: "en",
  supportedLocales: ["de", "en"],
  slotMinutes: 30,
  timeZone: "Pacific/Auckland",
  currency: "EUR", currencyFractionDigits: 2
};

// The provider remembers the server's fraction digits when the configuration arrives; this stand-in does the same.
export function WithClubConfiguration({ club = exampleClub, children }: { club?: ClubConfig; children: ReactNode }) {
  rememberFractionDigits(club.currency, club.currencyFractionDigits);
  return <ClubConfigurationContext value={{ club, changed: () => undefined, load: () => undefined, refresh: () => undefined }}>{children}</ClubConfigurationContext>;
}
