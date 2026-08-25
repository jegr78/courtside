package org.courtside.config.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.config.BookingSlotDuration;
import org.courtside.config.CredentialLifetime;
import org.courtside.config.ReminderLeadTime;
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

    @Test
    void givenAnAssignedRuleSetThatWasRetired_whenChangingSomethingElse_thenTheClubCanStillSave() {
        // given
        UUID passive = rules.activeRuleSet("Passive");
        config.update(bindingTo(passive));
        rules.deactivate(passive);

        // when — retiring takes a rule set out of the choices; it does not lock the form that
        // still names it, or a club could no longer correct its own name
        ClubConfigurationSnapshot snapshot = config.update(renamedTo("Example Racquet Club", passive));

        // then
        assertThat(snapshot.clubName()).isEqualTo("Example Racquet Club");
        assertThat(snapshot.noMembershipTypeRuleSetId()).isEqualTo(passive);
    }

    private ChangeClubConfigurationCommand renamedTo(String clubName, UUID ruleSetId) {
        ClubConfigurationSnapshot current = config.current();
        return new ChangeClubConfigurationCommand(
                clubName, current.primaryColor(), current.accentColor(),
                current.logoUrl(), current.imprintUrl(), current.defaultLocale(),
                new BookingSlotDuration(current.slotMinutes()), current.timeZone(),
                new CredentialLifetime(current.newAccountCredentialHours()),
                new CredentialLifetime(current.passwordResetCredentialHours()), new ReminderLeadTime(24), ruleSetId);
    }

    private ChangeClubConfigurationCommand bindingTo(UUID ruleSetId) {
        ClubConfigurationSnapshot current = config.current();
        return new ChangeClubConfigurationCommand(
                current.clubName(), current.primaryColor(), current.accentColor(),
                current.logoUrl(), current.imprintUrl(), current.defaultLocale(),
                new BookingSlotDuration(current.slotMinutes()), current.timeZone(),
                new CredentialLifetime(current.newAccountCredentialHours()),
                new CredentialLifetime(current.passwordResetCredentialHours()), new ReminderLeadTime(24), ruleSetId);
    }
}
