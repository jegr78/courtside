package org.courtside.config.internal;

import java.util.UUID;

public record ClubConfigurationSnapshot(
        String clubName,
        String primaryColor,
        String accentColor,
        String logoUrl,
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
                configuration.getLogoUrl(),
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
}
