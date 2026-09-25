import { useCallback, useState } from "react";
import type { AdminClubConfig, ClubConfig, ClubConfigRequest } from "../../api/client";
import { differs } from "../../unsaved/differs";

// Named field by field so a request-only shape cannot pick up what the response adds to it.
export function editable(loaded: AdminClubConfig): ClubConfigRequest {
  return {
    clubName: loaded.clubName,
    shortName: loaded.shortName ?? null,
    primaryColor: loaded.primaryColor,
    accentColor: loaded.accentColor,
    logoUrl: loaded.logoFallbackUrl,
    imprintUrl: loaded.imprintUrl,
    privacyUrl: loaded.privacyUrl,
    documentationUrl: loaded.documentationUrl,
    defaultLocale: loaded.defaultLocale,
    slotMinutes: loaded.slotMinutes,
    timeZone: loaded.timeZone,
    newAccountCredentialHours: loaded.newAccountCredentialHours,
    passwordResetCredentialHours: loaded.passwordResetCredentialHours,
    passwordResetTokenMinutes: loaded.passwordResetTokenMinutes,
    bookingReminderHours: loaded.bookingReminderHours,
    noMembershipTypeRuleSetId: loaded.noMembershipTypeRuleSetId ?? null
  };
}

// Every surface edits a part of one request, so each keeps the whole of it and sends it back complete.
export function useClubConfigForm(configurationChanged: (config: ClubConfig) => void) {
  const [config, setConfig] = useState<ClubConfigRequest>();
  const [saved, setSaved] = useState<ClubConfigRequest>();

  const loaded = useCallback((read: AdminClubConfig) => {
    setConfig((current) => current ?? editable(read));
    setSaved((current) => current ?? editable(read));
  }, []);

  const applied = useCallback((written: AdminClubConfig) => {
    const request = editable(written);
    setConfig(request);
    setSaved(request);
    configurationChanged(written);
  }, [configurationChanged]);

  const change = useCallback((changed: Partial<ClubConfigRequest>) => {
    setConfig((current) => current ? { ...current, ...changed } : current);
  }, []);

  return { config, saved, unsaved: differs(config, saved), loaded, applied, change };
}
