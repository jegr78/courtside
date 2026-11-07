package org.courtside.config.internal;

import org.courtside.config.AccessCodeLength;
import org.courtside.config.AccessLagTime;
import org.courtside.config.AccessLeadTime;
import org.courtside.config.BookingSlotDuration;
import org.courtside.config.CredentialLifetime;
import org.courtside.config.ReminderLeadTime;
import org.courtside.config.ResetTokenLifetime;
import org.courtside.config.WaitlistOfferWindow;

import java.util.Currency;
import java.util.UUID;

public record ChangeClubConfigurationCommand(
        String clubName,
        String primaryColor,
        String accentColor,
        String logoUrl,
        String imprintUrl,
        String privacyUrl,
        String documentationUrl,
        String shortName,
        String defaultLocale,
        BookingSlotDuration slotDuration,
        String timeZone,
        CredentialLifetime newAccountCredential,
        CredentialLifetime passwordResetCredential,
        ResetTokenLifetime passwordResetToken,
        ReminderLeadTime bookingReminder,
        UUID noMembershipTypeRuleSetId,
        WaitlistOfferWindow waitlistOffer,
        AccessLeadTime accessLead,
        AccessLagTime accessLag,
        AccessCodeLength accessCodeLength,
        Currency currency,
        Boolean externalBookings,
        RegistrationTexts registrationTexts) {

    // Links, logo, short name and the no-membership rule set may be unset, and an absent waitlist, access, currency,
    // external booking or registration text setting keeps the stored one; any other absent value is a caller bug.
    public ChangeClubConfigurationCommand {
        requirePresent(clubName, "clubName");
        requirePresent(primaryColor, "primaryColor");
        requirePresent(accentColor, "accentColor");
        requirePresent(defaultLocale, "defaultLocale");
        requirePresent(slotDuration, "slotDuration");
        requirePresent(timeZone, "timeZone");
        requirePresent(newAccountCredential, "newAccountCredential");
        requirePresent(passwordResetCredential, "passwordResetCredential");
        requirePresent(passwordResetToken, "passwordResetToken");
        requirePresent(bookingReminder, "bookingReminder");
        if (shortName != null && !AppShortName.fits(shortName)) {
            throw new IllegalArgumentException("A short name has to fit under an app icon");
        }
    }

    public ChangeClubConfigurationCommand(String clubName, String primaryColor, String accentColor, String logoUrl,
            String imprintUrl, String privacyUrl, String documentationUrl, String shortName, String defaultLocale,
            BookingSlotDuration slotDuration, String timeZone, CredentialLifetime newAccountCredential,
            CredentialLifetime passwordResetCredential, ResetTokenLifetime passwordResetToken,
            ReminderLeadTime bookingReminder, UUID noMembershipTypeRuleSetId, WaitlistOfferWindow waitlistOffer,
            AccessLeadTime accessLead, AccessLagTime accessLag, AccessCodeLength accessCodeLength) {
        this(clubName, primaryColor, accentColor, logoUrl, imprintUrl, privacyUrl, documentationUrl, shortName,
                defaultLocale, slotDuration, timeZone, newAccountCredential, passwordResetCredential,
                passwordResetToken, bookingReminder, noMembershipTypeRuleSetId, waitlistOffer, accessLead, accessLag,
                accessCodeLength, null, null);
    }

    public ChangeClubConfigurationCommand(String clubName, String primaryColor, String accentColor, String logoUrl,
            String imprintUrl, String privacyUrl, String documentationUrl, String shortName, String defaultLocale,
            BookingSlotDuration slotDuration, String timeZone, CredentialLifetime newAccountCredential,
            CredentialLifetime passwordResetCredential, ResetTokenLifetime passwordResetToken,
            ReminderLeadTime bookingReminder, UUID noMembershipTypeRuleSetId, WaitlistOfferWindow waitlistOffer,
            AccessLeadTime accessLead, AccessLagTime accessLag, AccessCodeLength accessCodeLength, Currency currency,
            Boolean externalBookings) {
        this(clubName, primaryColor, accentColor, logoUrl, imprintUrl, privacyUrl, documentationUrl, shortName,
                defaultLocale, slotDuration, timeZone, newAccountCredential, passwordResetCredential,
                passwordResetToken, bookingReminder, noMembershipTypeRuleSetId, waitlistOffer, accessLead, accessLag,
                accessCodeLength, currency, externalBookings, null);
    }

    /** Blank removes a text; each text stays within what the column holds. */
    public record RegistrationTexts(String german, String english) {

        public RegistrationTexts {
            german = german == null || german.isBlank() ? null : german.strip();
            english = english == null || english.isBlank() ? null : english.strip();
            if ((german != null && german.length() > 2000) || (english != null && english.length() > 2000)) {
                throw new IllegalArgumentException("A registration text holds at most 2000 characters");
            }
        }
    }

    private static void requirePresent(Object value, String field) {
        if (value == null) {
            throw new IllegalArgumentException("A club configuration change needs a " + field);
        }
    }
}
