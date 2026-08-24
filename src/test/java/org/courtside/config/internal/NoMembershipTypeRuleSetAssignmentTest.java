package org.courtside.config.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.config.BookingSlotDuration;
import org.courtside.config.CredentialLifetime;
import org.courtside.rules.testfixture.RulesTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

@Import(RulesTestFixture.class)
class NoMembershipTypeRuleSetAssignmentTest extends AbstractIntegrationTest {

    @Autowired
    private ConfigService config;

    @Autowired
    private RulesTestFixture rules;

    @Test
    void givenAnInactiveRuleSet_whenBindingPeopleWithoutAMembershipTypeToIt_thenItIsRefusedNamingTheField() {
        // given
        UUID retired = rules.inactiveRuleSet("Retired");

        // when
        NoMembershipTypeRuleSetInactiveException refusal = catchThrowableOfType(
                NoMembershipTypeRuleSetInactiveException.class, () -> config.update(bindingTo(retired)));

        // then
        assertThat(refusal.getCode()).isEqualTo("config.noMembershipTypeRuleSet.inactive");
        assertThat(refusal.getParams()).containsEntry("field", "noMembershipTypeRuleSetId");
        assertThat(config.current().noMembershipTypeRuleSetId()).isNull();
    }

    @Test
    void givenARuleSetIdNamingNothing_whenBindingPeopleWithoutAMembershipTypeToIt_thenItIsRefused() {
        // when
        NoMembershipTypeRuleSetInvalidException refusal = catchThrowableOfType(
                NoMembershipTypeRuleSetInvalidException.class,
                () -> config.update(bindingTo(UUID.randomUUID())));

        // then
        assertThat(refusal.getCode()).isEqualTo("config.noMembershipTypeRuleSet.unresolvable");
        assertThat(refusal.getParams()).containsEntry("field", "noMembershipTypeRuleSetId");
    }

    @Test
    void givenAnActiveRuleSet_whenBindingPeopleWithoutAMembershipTypeToIt_thenTheConfigurationCarriesIt() {
        // given
        UUID guests = rules.activeRuleSet("Guests");

        // when
        ClubConfigurationSnapshot snapshot = config.update(bindingTo(guests));

        // then
        assertThat(snapshot.noMembershipTypeRuleSetId()).isEqualTo(guests);
    }

    private ChangeClubConfigurationCommand bindingTo(UUID ruleSetId) {
        ClubConfigurationSnapshot current = config.current();
        return new ChangeClubConfigurationCommand(
                current.clubName(), current.primaryColor(), current.accentColor(),
                current.logoUrl(), current.imprintUrl(), current.defaultLocale(),
                new BookingSlotDuration(current.slotMinutes()), current.timeZone(),
                new CredentialLifetime(current.newAccountCredentialHours()),
                new CredentialLifetime(current.passwordResetCredentialHours()), ruleSetId);
    }
}
