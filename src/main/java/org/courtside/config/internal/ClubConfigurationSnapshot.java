package org.courtside.config.internal;

public record ClubConfigurationSnapshot(
        String clubName,
        String primaryColor,
        String accentColor,
        String logoUrl,
        String imprintUrl,
        String defaultLocale,
        int slotMinutes,
        String timeZone) {

    static ClubConfigurationSnapshot from(ClubConfiguration configuration) {
        return new ClubConfigurationSnapshot(
                configuration.getClubName(),
                configuration.getPrimaryColor(),
                configuration.getAccentColor(),
                configuration.getLogoUrl(),
                configuration.getImprintUrl(),
                configuration.getDefaultLocale(),
                configuration.getSlotMinutes(),
                configuration.getTimeZone());
    }
}
