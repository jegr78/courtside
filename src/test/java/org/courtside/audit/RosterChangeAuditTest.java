package org.courtside.audit;

import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import({AuditTestFixture.class, MemberTestFixture.class, IdentityTestFixture.class})
class RosterChangeAuditTest extends AbstractIntegrationTest {

    @Autowired
    private MemberTestFixture roster;

    @Autowired
    private AuditTestFixture audit;

    @Autowired
    private IdentityTestFixture identity;

    @AfterEach
    void signOut() {
        identity.signOut();
    }

    @Test
    void givenABoardAddsAPerson_whenTheChangeIsCommitted_thenTheAuditLogHoldsIt() {
        // when
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");

        // then
        assertThat(audit.eventsAbout(personId)).singleElement().satisfies(event -> {
            assertThat(event.eventType()).isEqualTo("roster.person.added");
            assertThat(event.payload()).containsEntry("personId", personId.toString());
        });
    }

    @Test
    void givenABoardAddsAPerson_whenTheAuditLogResolvesTheSubject_thenItNamesThePerson() {
        // when
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");

        // then
        assertThat(audit.nameOf(personId)).isEqualTo("Jane Doe");
    }

    @Test
    void givenAPersonIsCorrected_whenTheAuditLogIsRead_thenItNamesTheFieldsAndNotTheirValues() {
        // given
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");

        // when
        roster.changePerson(personId, "Mary", "Doe", "jane.doe@example.org");

        // then
        assertThat(audit.eventsAbout(personId)).extracting(AuditTestFixture.RecordedEvent::eventType)
                .containsExactlyInAnyOrder("roster.person.added", "roster.person.corrected");
        Map<String, Object> corrected = audit.latestPayload(personId, "roster.person.corrected");
        assertThat(corrected).containsEntry("fields", List.of("firstName"));
        assertThat(corrected.toString()).doesNotContain("Mary").doesNotContain("Doe");
    }

    @Test
    void givenAnAccountIsGivenAndChanged_whenTheAuditLogIsRead_thenEveryStepIsThere() {
        // given
        UUID personId = roster.addPerson("John", "Roe", "john.roe@example.org");

        // when
        roster.giveAccount(personId, "roe.john", "handover-password", Set.of(Role.MEMBER));
        roster.changeAccountRoles(personId, Set.of(Role.MEMBER, Role.TRAINER));
        roster.correctAccountUsername(personId, "roe.johnny");
        roster.resetAccountPassword(personId, "another-password");
        roster.setAccountEnabled(personId, false);

        // then
        assertThat(audit.eventsAbout(personId)).extracting(AuditTestFixture.RecordedEvent::eventType)
                .containsExactlyInAnyOrder("roster.person.added", "roster.account.created",
                        "roster.account.rolesChanged", "roster.account.usernameCorrected",
                        "roster.account.passwordReset", "roster.account.availabilityChanged");
    }

    @Test
    void givenAMembershipIsWrittenAndEnded_whenTheAuditLogIsRead_thenItCarriesTypeAndDatesButNoName() {
        // given
        UUID personId = roster.addPerson("Mary", "Major", "mary.major@example.org");
        UUID membershipTypeId = roster.createMembershipType("Adults");

        // when
        roster.assignMembership(personId, membershipTypeId);
        roster.endMembership(personId);

        // then
        assertThat(audit.eventsAbout(personId)).extracting(AuditTestFixture.RecordedEvent::eventType)
                .containsExactlyInAnyOrder("roster.person.added", "roster.membership.written",
                        "roster.membership.ended");
        assertThat(audit.latestPayload(personId, "roster.membership.written"))
                .containsEntry("membershipTypeId", membershipTypeId.toString())
                .containsEntry("startedOn", "2026-01-01");
    }

    @Test
    void givenAnAdministratorMakesTheChange_whenTheAuditLogIsRead_thenItNamesTheAccountThatDidIt() {
        // given
        UUID actorPersonId = identity.createPerson("Richard", "Miles");
        UUID actorAccountId = identity.createEnabledAccount(actorPersonId, "miles.richard", Set.of(Role.ADMIN));
        identity.signInAs("miles.richard");

        // when
        UUID personId = roster.addPerson("Jane", "Roe", "jane.roe@example.org");

        // then
        assertThat(audit.eventsAbout(personId)).singleElement()
                .extracting(AuditTestFixture.RecordedEvent::actorAccountId)
                .isEqualTo(actorAccountId);
    }

    @Test
    void givenAnAdministratorRenamesTheirOwnAccount_whenTheAuditLogIsRead_thenItStillNamesThem() {
        // given
        UUID personId = identity.createPerson("Richard", "Miles");
        UUID accountId = identity.createEnabledAccount(personId, "miles.richard", Set.of(Role.ADMIN));
        identity.signInAs("miles.richard");

        // when
        roster.correctAccountUsername(personId, "miles.rich");

        // then
        assertThat(audit.eventsAbout(personId)).last()
                .extracting(AuditTestFixture.RecordedEvent::actorAccountId)
                .isEqualTo(accountId);
    }

    @Test
    void givenASynchronisationCorrectsAName_whenTheAuditLogIsRead_thenItIsRecordedLikeAnyOtherChange() {
        // given
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");

        // when
        roster.synchroniseCorrectedLastName(personId, "Roe");

        // then
        assertThat(audit.eventsAbout(personId)).extracting(AuditTestFixture.RecordedEvent::eventType)
                .containsExactlyInAnyOrder("roster.person.added", "roster.person.corrected");
        assertThat(audit.latestPayload(personId, "roster.person.corrected"))
                .containsEntry("fields", List.of("lastName"));
    }

    @Test
    void givenASynchronisationEndsTheLastMembership_whenTheAuditLogIsRead_thenTheDisablingIsRecorded() {
        // given
        UUID personId = roster.addPerson("John", "Roe", "john.roe@example.org");
        UUID membershipTypeId = roster.createMembershipType("Adults");
        roster.assignMembership(personId, membershipTypeId);
        roster.giveAccount(personId, "roe.john", "handover-password", Set.of(Role.MEMBER));

        // when
        roster.synchroniseDeparture(personId);

        // then
        assertThat(audit.eventsAbout(personId)).extracting(AuditTestFixture.RecordedEvent::eventType)
                .containsExactlyInAnyOrder("roster.person.added", "roster.membership.written",
                        "roster.account.created", "roster.membership.ended",
                        "roster.account.availabilityChanged");
        assertThat(audit.latestPayload(personId, "roster.account.availabilityChanged"))
                .containsEntry("enabled", false);
    }
}
