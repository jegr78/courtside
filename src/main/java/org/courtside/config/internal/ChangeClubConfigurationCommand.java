package org.courtside.config.internal;

import org.courtside.config.BookingSlotDuration;
import org.courtside.config.CredentialLifetime;

public record ChangeClubConfigurationCommand(
        String clubName,
        String primaryColor,
        String accentColor,
        String logoUrl,
        String imprintUrl,
        String defaultLocale,
        BookingSlotDuration slotDuration,
        String timeZone,
        CredentialLifetime newAccountCredential,
        CredentialLifetime passwordResetCredential) {

    public int slotMinutes() {
        return slotDuration.minutes();
    }
}
