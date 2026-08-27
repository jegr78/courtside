package org.courtside.config.internal;

import org.courtside.config.BookingSlotDuration;
import org.courtside.config.CredentialLifetime;
import org.courtside.config.ReminderLeadTime;

import java.util.UUID;

public record ChangeClubConfigurationCommand(
        String clubName,
        String primaryColor,
        String accentColor,
        String logoUrl,
        String imprintUrl,
        String privacyUrl,
        String defaultLocale,
        BookingSlotDuration slotDuration,
        String timeZone,
        CredentialLifetime newAccountCredential,
        CredentialLifetime passwordResetCredential,
        ReminderLeadTime bookingReminder,
        UUID noMembershipTypeRuleSetId) {

    // The two link fields, a logo and the rule set for people holding no membership type are what a
    // club may leave unset; an absent value anywhere else is a caller that skipped its validation.
    public ChangeClubConfigurationCommand {
        requirePresent(clubName, "clubName");
        requirePresent(primaryColor, "primaryColor");
        requirePresent(accentColor, "accentColor");
        requirePresent(defaultLocale, "defaultLocale");
        requirePresent(slotDuration, "slotDuration");
        requirePresent(timeZone, "timeZone");
        requirePresent(newAccountCredential, "newAccountCredential");
        requirePresent(passwordResetCredential, "passwordResetCredential");
        requirePresent(bookingReminder, "bookingReminder");
    }

    private static void requirePresent(Object value, String field) {
        if (value == null) {
            throw new IllegalArgumentException("A club configuration change needs a " + field);
        }
    }
}
