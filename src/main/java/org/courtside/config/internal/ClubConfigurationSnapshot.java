package org.courtside.config.internal;

import java.util.UUID;

public record ClubConfigurationSnapshot(
        String clubName,
        String primaryColor,
        String accentColor,
        String logoUrl,
        String logoFallbackUrl,
        boolean logoUploaded,
        String imprintUrl,
        String privacyUrl,
        String defaultLocale,
        int slotMinutes,
        String timeZone,
        int newAccountCredentialHours,
        int passwordResetCredentialHours,
        int bookingReminderHours,
        UUID noMembershipTypeRuleSetId) {

    static ClubConfigurationSnapshot from(ClubConfiguration configuration) {
        return new ClubConfigurationSnapshot(
                configuration.getClubName(),
                configuration.getPrimaryColor(),
                configuration.getAccentColor(),
                effectiveLogoUrl(configuration),
                configuration.getLogoUrl(),
                configuration.getLogoDigest() != null,
                configuration.getImprintUrl(),
                configuration.getPrivacyUrl(),
                configuration.getDefaultLocale(),
                configuration.getSlotMinutes(),
                configuration.getTimeZone(),
                configuration.getNewAccountCredentialHours(),
                configuration.getPasswordResetCredentialHours(),
                configuration.getBookingReminderHours(),
                configuration.getNoMembershipTypeRuleSetId());
    }

    private static String effectiveLogoUrl(ClubConfiguration configuration) {
        String digest = configuration.getLogoDigest();
        return digest == null ? configuration.getLogoUrl()
                : "/api/public/config/logo?v=" + digest;
    }
}
