package org.courtside.member.testfixture;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import({IdentityTestFixture.class, MemberTestFixture.class})
class MemberTestFixtureTest extends AbstractIntegrationTest {

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    @Test
    void givenAPersonAndMembershipType_whenAssigningMembership_thenStateIsObservableByIdentifier() {
        // given
        UUID personId = identity.createPerson("Jane", "Doe");
        UUID membershipTypeId = members.createMembershipType("Adults");
        LocalDate startedOn = LocalDate.of(2026, 1, 1);

        // when
        members.assignMembership(personId, membershipTypeId, startedOn);

        // then
        assertThat(members.membershipTypeIdOf(personId)).contains(membershipTypeId);
        assertThat(members.membershipStartedOn(personId)).contains(startedOn);
    }

    @Test
    void givenAPeriodRunningTodayWithAnEndAhead_whenReadingItsStart_thenTheStartIsObservable() {
        // given
        UUID personId = identity.createPerson("Jane", "Doe");
        UUID membershipTypeId = members.createMembershipType("Adults");

        // when
        members.addMembershipPeriod(personId, membershipTypeId, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 12, 1));

        // then
        assertThat(members.membershipStartedOn(personId))
                .as("a running period reads as running even when its end is already set")
                .contains(LocalDate.of(2026, 1, 1));
    }

    @Test
    void givenAnActiveMembershipType_whenDeactivatingIt_thenItsStateIsObservableByIdentifier() {
        // given
        UUID membershipTypeId = members.createMembershipType("Passive");

        // when
        members.deactivateMembershipType(membershipTypeId);

        // then
        assertThat(members.isMembershipTypeActive(membershipTypeId)).isFalse();
    }

    @Test
    void givenACurrentMembership_whenEndingIt_thenNoCurrentTypeRemains() {
        // given
        UUID personId = identity.createPerson("John", "Roe");
        UUID membershipTypeId = members.createMembershipType("Fixture Youth");
        members.assignMembership(personId, membershipTypeId);

        // when
        members.endMembership(personId);

        // then
        assertThat(members.membershipTypeIdOf(personId)).isEmpty();
    }
}
