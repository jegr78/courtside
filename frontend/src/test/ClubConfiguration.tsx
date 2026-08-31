import type { ReactNode } from "react";
import type { ClubConfig } from "../api/client";
import { ClubConfigurationContext } from "../club/registry";

const exampleClub: ClubConfig = {
  clubName: "Example Tennis Club",
  primaryColor: "#b85c38",
  accentColor: "#d7e24b",
  defaultLocale: "en",
  supportedLocales: ["de", "en"],
  slotMinutes: 30,
  timeZone: "Pacific/Auckland"
};

export function WithClubConfiguration({ club = exampleClub, children }: { club?: ClubConfig; children: ReactNode }) {
  return <ClubConfigurationContext value={{ club, changed: () => undefined, load: () => undefined }}>{children}</ClubConfigurationContext>;
}
