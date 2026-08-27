package org.courtside.config.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.config.BookingSlotDuration;
import org.courtside.config.CredentialLifetime;
import org.courtside.config.ReminderLeadTime;
import org.courtside.config.internal.ChangeClubConfigurationCommand;
import org.courtside.config.internal.ClubConfigurationSnapshot;
import org.courtside.config.internal.ConfigService;

import java.util.UUID;

@RequiredArgsConstructor
public class ConfigTestFixture {

    private final ConfigService config;

    public void bindPeopleWithoutAMembershipTypeTo(UUID ruleSetId) {
        ClubConfigurationSnapshot current = config.current();
        config.update(commandFrom(current, current.bookingReminderHours(), ruleSetId));
    }

    public void remindBookingsAfter(int hours) {
        ClubConfigurationSnapshot current = config.current();
        config.update(commandFrom(current, hours, current.noMembershipTypeRuleSetId()));
    }

    public UUID ruleSetForPeopleWithoutAMembershipType() {
        return config.current().noMembershipTypeRuleSetId();
    }

    public int bookingReminderHours() {
        return config.current().bookingReminderHours();
    }

    private static ChangeClubConfigurationCommand commandFrom(ClubConfigurationSnapshot current,
                                                             int reminderHours, UUID ruleSetId) {
        return new ChangeClubConfigurationCommand(
                current.clubName(), current.primaryColor(), current.accentColor(),
                current.logoUrl(), current.imprintUrl(), current.privacyUrl(), current.defaultLocale(),
                new BookingSlotDuration(current.slotMinutes()), current.timeZone(),
                new CredentialLifetime(current.newAccountCredentialHours()),
                new CredentialLifetime(current.passwordResetCredentialHours()),
                new ReminderLeadTime(reminderHours), ruleSetId);
    }
}
