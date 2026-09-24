import { createContext, useContext, useEffect } from "react";
import type { ClubConfig } from "../api/client";

export type ClubConfiguration = {
  club?: ClubConfig;
  error?: string;
  changed: (club: ClubConfig) => void;
  load: () => void;
};

export const ClubConfigurationContext = createContext<ClubConfiguration | undefined>(undefined);

// A view asks on mount rather than the provider once, so a club that could not be read is tried
// again on the next page instead of leaving every later view without one until a reload.
export function useClubConfiguration(): ClubConfiguration {
  const held = useHeldConfiguration();
  const { load } = held;
  useEffect(() => {
    load();
  }, [load]);
  return held;
}

function useHeldConfiguration(): ClubConfiguration {
  const held = useContext(ClubConfigurationContext);
  if (!held) {
    throw new Error("The club configuration can only be read inside a ClubConfigurationProvider");
  }
  return held;
}
