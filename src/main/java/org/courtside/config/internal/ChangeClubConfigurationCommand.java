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

    // A logo and an imprint are the two a club may leave unset. Everything else names something the
    // instance cannot operate without, so an absent one is a caller that skipped its own validation.
    public ChangeClubConfigurationCommand {
        requirePresent(clubName, "clubName");
        requirePresent(primaryColor, "primaryColor");
        requirePresent(accentColor, "accentColor");
        requirePresent(defaultLocale, "defaultLocale");
        requirePresent(slotDuration, "slotDuration");
        requirePresent(timeZone, "timeZone");
        requirePresent(newAccountCredential, "newAccountCredential");
        requirePresent(passwordResetCredential, "passwordResetCredential");
    }

    private static void requirePresent(Object value, String field) {
        if (value == null) {
            throw new IllegalArgumentException("A club configuration change needs a " + field);
        }
    }
}
