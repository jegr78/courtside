import { useCallback, useState } from "react";
import { api, type AdminClubConfig, type ClubConfig, type ClubConfigRequest } from "../../api/client";
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

type ConfigField = keyof ClubConfigRequest;

export const ownedFields = {
  clubProfile: ["clubName", "shortName", "primaryColor", "accentColor", "logoUrl", "imprintUrl", "privacyUrl",
    "documentationUrl", "defaultLocale", "timeZone", "slotMinutes"],
  deadlines: ["newAccountCredentialHours", "passwordResetCredentialHours", "passwordResetTokenMinutes", "bookingReminderHours"],
  ruleSets: ["noMembershipTypeRuleSetId"]
} satisfies Record<string, readonly ConfigField[]>;

function withOwn(fresh: ClubConfigRequest, edited: ClubConfigRequest, owned: readonly ConfigField[]): ClubConfigRequest {
  return owned.reduce((request, field) => ({ ...request, [field]: edited[field] }), fresh);
}

// Each surface owns part of one request, and the rest is read again just before the write so a
// page opened earlier cannot put back what another page has saved since.
export function useClubConfigForm(configurationChanged: (config: ClubConfig) => void, owned: readonly ConfigField[]) {
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

  const save = useCallback(async (edited: ClubConfigRequest): Promise<AdminClubConfig> => {
    const fresh = editable(await api.adminConfig());
    return api.changeAdminConfig(withOwn(fresh, edited, owned));
  }, [owned]);

  return { config, saved, unsaved: differs(config, saved), loaded, applied, change, save };
}
