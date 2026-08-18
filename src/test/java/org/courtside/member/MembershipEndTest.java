package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.internal.MembershipType;
import org.courtside.member.internal.MembershipTypeInactiveException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import(IdentityTestFixture.class)
class MembershipEndTest extends AbstractIntegrationTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 5, 12);

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberRepository members;

    @Autowired
    private MemberService memberships;

    @Autowired
    private RosterService roster;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenAMembershipThatEnded_whenAskingWhichTypeBindsThePerson_thenNoneDoes() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null);
        roster.writeMembership(mary, type.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), null));

        // when
        roster.writeMembership(mary, type.getId(),
                new MembershipPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 4, 30)));

        // then
        assertThat(memberships.membershipTypeIdOf(mary)).isEmpty();
        assertThat(members.findByPersonId(mary))
                .as("the record stays, carrying the type they last held and the date it ended")
                .get()
                .satisfies(member -> {
                    assertThat(member.getMembershipTypeId()).isEqualTo(type.getId());
                    assertThat(member.getEndedOn()).isEqualTo(LocalDate.of(2026, 4, 30));
                });
    }

    @Test
    void givenAMembershipDatedToEndInDecember_whenWritingIt_thenTheFutureDateIsRefused() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null);

        // when / then
        assertThatThrownBy(() -> roster.writeMembership(mary, type.getId(),
                new MembershipPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 12, 31))))
                .isInstanceOf(InvalidMembershipPeriodException.class)
                .extracting("code")
                .isEqualTo("membershipPeriod.inTheFuture");
        assertThat(members.findByPersonId(mary)).isEmpty();
    }

    @Test
    void givenAMembershipDatedToBeginNextYear_whenWritingIt_thenTheFutureDateIsRefused() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null);

        // when / then
        assertThatThrownBy(() -> roster.writeMembership(mary, type.getId(),
                new MembershipPeriod(LocalDate.of(2027, 1, 1), null)))
                .isInstanceOf(InvalidMembershipPeriodException.class)
                .extracting("code")
                .isEqualTo("membershipPeriod.inTheFuture");
        assertThat(members.findByPersonId(mary)).isEmpty();
    }

    @Test
    void givenAMembershipThatBeganToday_whenTheRosterEndsIt_thenItEndsWithoutInvertingItself() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null);
        roster.writeMembership(mary, type.getId(), MembershipPeriod.running());

        // when
        roster.endMembership(mary);

        // then
        assertThat(members.findByPersonId(mary))
                .get()
                .satisfies(member -> {
                    assertThat(member.getStartedOn()).isEqualTo(TODAY);
                    assertThat(member.getEndedOn()).isEqualTo(TODAY);
                });
    }

    @Test
    void givenADormantMembershipOnARetiredType_whenRevivingIt_thenTheRetiredTypeIsRefused() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType retired = memberships.createMembershipType("Passive", null);
        roster.writeMembership(mary, retired.getId(),
                new MembershipPeriod(LocalDate.of(2024, 1, 1), LocalDate.of(2024, 12, 31)));
        memberships.setMembershipTypeActive(retired.getId(), false);

        // when / then
        assertThatThrownBy(() -> roster.writeMembership(
                mary, retired.getId(), MembershipPeriod.running()))
                .isInstanceOf(MembershipTypeInactiveException.class);
        assertThat(memberships.membershipTypeIdOf(mary))
                .as("a type the club no longer offers does not take a member back")
                .isEmpty();
    }

    @Test
    void givenARunningMembershipOnARetiredType_whenEndingIt_thenEndingStaysPossible() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType retired = memberships.createMembershipType("Passive", null);
        roster.writeMembership(mary, retired.getId(), MembershipPeriod.running());
        memberships.setMembershipTypeActive(retired.getId(), false);

        // when
        roster.endMembership(mary);

        // then
        assertThat(memberships.membershipTypeIdOf(mary)).isEmpty();
    }

    @Test
    void givenARunningMembership_whenOnlyItsStartDateIsCorrected_thenTheCorrectionIsStored() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null);
        roster.writeMembership(mary, type.getId(),
                new MembershipPeriod(LocalDate.of(2026, 1, 1), null));

        // when
        RosterService.RosterEntry entry = roster.writeMembership(mary, type.getId(),
                new MembershipPeriod(LocalDate.of(2020, 9, 1), null));

        // then
        assertThat(entry.membership().startedOn()).isEqualTo(LocalDate.of(2020, 9, 1));
        assertThat(members.findByPersonId(mary))
                .get()
                .satisfies(member ->
                        assertThat(member.getStartedOn()).isEqualTo(LocalDate.of(2020, 9, 1)));
    }

    @Test
    void whenAPeriodEndsBeforeItBegan_thenItCannotBeBuiltAtAll() {
        // when / then
        assertThatThrownBy(() ->
                new MembershipPeriod(LocalDate.of(2026, 5, 1), LocalDate.of(2026, 4, 30)))
                .isInstanceOf(InvalidMembershipPeriodException.class)
                .extracting("code")
                .isEqualTo("membershipPeriod.endsBeforeItBegan");
    }

    @Test
    void givenAWriteThatBypassesThePeriodType_whenItInvertsTheDates_thenTheDatabaseRefusesIt() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null);

        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                        INSERT INTO member (id, person_id, membership_type_id, started_on, ended_on)
                        VALUES (:id, :personId, :typeId, DATE '2026-05-01', DATE '2026-04-30')
                        """)
                .param("id", UUID.randomUUID())
                .param("personId", mary)
                .param("typeId", type.getId())
                .update())
                .hasMessageContaining("member_period_ordered");
    }

    @Test
    void givenAMembershipThatAlreadyEnded_whenEndingItAgain_thenTheRecordedDateStands() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null);
        roster.writeMembership(mary, type.getId(),
                new MembershipPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 3, 31)));

        // when
        roster.endMembership(mary);

        // then
        assertThat(members.findByPersonId(mary))
                .get()
                .satisfies(member -> assertThat(member.getEndedOn())
                        .as("a second ending does not move the date to today")
                        .isEqualTo(LocalDate.of(2026, 3, 31)));
    }

    @Test
    void givenAMembershipThatEnded_whenTheSameTypeIsWrittenAgain_thenItRunsAgainFromTheNewStart() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null);
        roster.writeMembership(mary, type.getId(),
                new MembershipPeriod(LocalDate.of(2024, 1, 1), LocalDate.of(2024, 12, 31)));

        // when
        roster.writeMembership(mary, type.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), null));

        // then
        assertThat(memberships.membershipTypeIdOf(mary)).contains(type.getId());
        assertThat(members.findByPersonIdIn(List.of(mary)))
                .as("a rejoin revives the one record rather than adding a second")
                .singleElement()
                .satisfies(member -> {
                    assertThat(member.getStartedOn()).isEqualTo(LocalDate.of(2026, 1, 1));
                    assertThat(member.getEndedOn()).isNull();
                });
    }

    @Test
    void givenAMembershipEndedOnTheWrongDate_whenTheDateIsCorrected_thenTheCorrectionHolds() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null);
        roster.writeMembership(mary, type.getId(),
                new MembershipPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 3, 31)));

        // when
        roster.writeMembership(mary, type.getId(),
                new MembershipPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 4, 30)));

        // then
        assertThat(members.findByPersonId(mary))
                .get()
                .satisfies(member ->
                        assertThat(member.getEndedOn()).isEqualTo(LocalDate.of(2026, 4, 30)));
    }

    @Test
    void givenAMembershipOnATypeTheClubRetired_whenCorrectingItsEndDate_thenItIsNotRefused() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType retired = memberships.createMembershipType("Passive", null);
        roster.writeMembership(mary, retired.getId(),
                new MembershipPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 3, 31)));
        memberships.setMembershipTypeActive(retired.getId(), false);

        // when
        RosterService.RosterEntry entry = roster.writeMembership(mary, retired.getId(),
                new MembershipPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 4, 30)));

        // then
        assertThat(entry.membership().endedOn()).isEqualTo(LocalDate.of(2026, 4, 30));
    }

    @Test
    void givenAMembershipOnATypeTheClubRetired_whenMovingThePersonOntoIt_thenItIsRefused() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType running = memberships.createMembershipType("Adults", null);
        MembershipType retired = memberships.createMembershipType("Passive", null);
        roster.writeMembership(mary, running.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), null));
        memberships.setMembershipTypeActive(retired.getId(), false);

        // when / then
        assertThatThrownBy(() -> roster.writeMembership(
                mary, retired.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), null)))
                .isInstanceOf(MembershipTypeInactiveException.class);
        assertThat(memberships.membershipTypeIdOf(mary)).contains(running.getId());
    }

    @Test
    void givenARunningMembership_whenTheTypeChanges_thenTheDateItBeganStands() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType first = memberships.createMembershipType("Junior", null);
        MembershipType second = memberships.createMembershipType("Adults", null);
        roster.writeMembership(mary, first.getId(), new MembershipPeriod(LocalDate.of(2020, 9, 1), null));

        // when
        RosterService.RosterEntry entry =
                roster.writeMembership(mary, second.getId(), MembershipPeriod.running());

        // then
        assertThat(entry.membership().typeId()).isEqualTo(second.getId());
        assertThat(entry.membership().startedOn())
                .as("changing the type continues the membership; it does not start a new one")
                .isEqualTo(LocalDate.of(2020, 9, 1));
    }

    @Test
    void givenAMembershipThatEnded_whenSearchingForCoPlayers_thenThePersonIsNotOffered() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null);
        roster.writeMembership(mary, type.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), null));
        assertThat(memberships.findParticipants("major")).isNotEmpty();

        // when
        roster.endMembership(mary);

        // then
        assertThat(memberships.findParticipants("major")).isEmpty();
    }

    @Test
    void givenARunningMembership_whenTheRosterEndsIt_thenItEndsOnTheClubsToday() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null);
        roster.writeMembership(mary, type.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), null));

        // when
        roster.endMembership(mary);

        // then
        assertThat(members.findByPersonId(mary))
                .get()
                .satisfies(member -> assertThat(member.getEndedOn()).isEqualTo(TODAY));
    }

    @Test
    void givenAMembershipWrittenWithoutAStart_whenReadingIt_thenItBeganOnTheClubsToday() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null);

        // when
        RosterService.RosterEntry entry =
                roster.writeMembership(mary, type.getId(), MembershipPeriod.running());

        // then
        assertThat(entry.membership().startedOn()).isEqualTo(TODAY);
        assertThat(entry.membership().endedOn()).isNull();
    }
}
