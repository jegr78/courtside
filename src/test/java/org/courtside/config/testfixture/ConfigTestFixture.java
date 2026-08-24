package org.courtside.config.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.config.BookingSlotDuration;
import org.courtside.config.CredentialLifetime;
import org.courtside.config.internal.ChangeClubConfigurationCommand;
import org.courtside.config.internal.ClubConfigurationSnapshot;
import org.courtside.config.internal.ConfigService;

import java.util.UUID;

@RequiredArgsConstructor
public class ConfigTestFixture {

    private final ConfigService config;

    public void bindPeopleWithoutAMembershipTypeTo(UUID ruleSetId) {
        ClubConfigurationSnapshot current = config.current();
        config.update(new ChangeClubConfigurationCommand(
                current.clubName(), current.primaryColor(), current.accentColor(),
                current.logoUrl(), current.imprintUrl(), current.defaultLocale(),
                new BookingSlotDuration(current.slotMinutes()), current.timeZone(),
                new CredentialLifetime(current.newAccountCredentialHours()),
                new CredentialLifetime(current.passwordResetCredentialHours()),
                ruleSetId));
    }

    public UUID ruleSetForPeopleWithoutAMembershipType() {
        return config.current().noMembershipTypeRuleSetId();
    }
}
