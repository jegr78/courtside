package org.courtside.audit;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.as;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.InstanceOfAssertFactories.MAP;

@Import({MemberTestFixture.class, IdentityTestFixture.class})
class PersonAuditTrailTest extends AbstractIntegrationTest {

    @Autowired
    private PersonAuditTrail trail;

    @Autowired
    private MemberTestFixture roster;

    @Autowired
    private IdentityTestFixture identity;

    @AfterEach
    void signOut() {
        identity.signOut();
    }

    @Test
    void givenChangesAboutAPerson_whenTheirSubjectTrailIsRead_thenItHoldsEachOfThemWithItsParameters() {
        // given
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        roster.changePerson(personId, "Jane", "Roe", "jane.roe@example.org");

        // when
        List<PersonAuditTrail.SubjectEntry> entries = trail.recordedAbout(personId);

        // then
        // The test clock is fixed, so both entries share an instant and only the set is decided.
        assertThat(entries).extracting(PersonAuditTrail.SubjectEntry::eventType)
                .containsExactlyInAnyOrder("roster.person.added", "roster.person.corrected");
        assertThat(entries).filteredOn(entry -> entry.eventType().equals("roster.person.corrected"))
                .singleElement()
                .extracting(PersonAuditTrail.SubjectEntry::parameters, as(MAP))
                .containsKeys("personId", "fields")
                .extractingByKey("personId")
                .hasToString("\"" + personId + "\"");
    }

    @Test
    void givenAPersonCorrectedSomebodyElsesRecord_whenTheirActorTrailIsRead_thenItCarriesNothingAboutTheOther() {
        // given
        UUID boardPersonId = identity.createPerson("Mary", "Major");
        UUID accountId = identity.createEnabledAccount(boardPersonId, "mary.major", Set.of(Role.ADMIN));
        UUID otherPersonId = roster.addPerson("John", "Roe", "john.roe@example.org");
        identity.signInAs("mary.major");

        // when
        roster.changePerson(otherPersonId, "John", "Miles", "john.miles@example.org");

        // then
        List<PersonAuditTrail.ActorEntry> entries = trail.recordedBy(accountId);
        assertThat(entries).extracting(PersonAuditTrail.ActorEntry::eventType)
                .containsExactly("roster.person.corrected");
        assertThat(entries.getFirst().toString())
                .doesNotContain(otherPersonId.toString())
                .doesNotContain("lastName");
    }

    @Test
    void whenAnActorTrailIsReadWithoutAnAccount_thenItRefusesRatherThanAnsweringWithEveryUnattendedChange() {
        // given
        roster.addPerson("Jane", "Doe", "jane.doe@example.org");

        // when / then
        assertThatThrownBy(() -> trail.recordedBy(null))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void givenAPersonHasNeverActed_whenTheirActorTrailIsRead_thenItIsEmpty() {
        // given
        UUID personId = identity.createPerson("Richard", "Miles");
        UUID accountId = identity.createEnabledAccount(personId, "richard.miles", Set.of(Role.MEMBER));

        // when / then
        assertThat(trail.recordedBy(accountId)).isEmpty();
    }
}
