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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

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
    private MembershipPeriodService periods;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenAMembershipThatEnded_whenAskingWhichTypeBindsThePerson_thenNoneDoes() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null, false);
        roster.writeMembership(mary, type.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), null));

        // when
        roster.writeMembership(mary, type.getId(),
                new MembershipPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 4, 30)));

        // then
        assertThat(memberships.membershipTypeIdOf(mary)).isEmpty();
        assertThat(MemberFixtures.latestPeriodOf(members, mary))
                .as("the record stays, carrying the type they last held and the date it ended")
                .get()
                .satisfies(member -> {
                    assertThat(member.getMembershipTypeId()).isEqualTo(type.getId());
                    assertThat(member.getEndedOn()).isEqualTo(LocalDate.of(2026, 4, 30));
                });
    }

    @Test
    void givenAMembershipDatedToEndInDecember_whenWritingIt_thenItBindsUntilThen() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null, false);

        // when
        roster.writeMembership(mary, type.getId(),
                new MembershipPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 12, 31)));

        // then
        assertThat(memberships.membershipTypeIdOf(mary)).contains(type.getId());
        assertThat(MemberFixtures.latestPeriodOf(members, mary)).get()
                .satisfies(member -> assertThat(member.getEndedOn()).isEqualTo(LocalDate.of(2026, 12, 31)));
    }

    @Test
    void givenAMembershipDatedToBeginNextYear_whenWritingIt_thenItGrantsNothingYet() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null, false);

        // when
        roster.writeMembership(mary, type.getId(), new MembershipPeriod(LocalDate.of(2027, 1, 1), null));

        // then
        assertThat(memberships.membershipTypeIdOf(mary)).isEmpty();
        assertThat(MemberFixtures.latestPeriodOf(members, mary)).get()
                .satisfies(member -> assertThat(member.getStartedOn()).isEqualTo(LocalDate.of(2027, 1, 1)));
    }

    @Test
    void givenARunningPeriodAndOneScheduledAhead_whenTheRosterEndsTheMembership_thenNeitherHoldsAnyLonger() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null, false);
        periods.add(mary, type.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 7, 1)));
        periods.add(mary, type.getId(), new MembershipPeriod(LocalDate.of(2026, 7, 1), null));

        // when
        roster.endMembership(mary);

        // then
        assertThat(periods.periodsOf(mary))
                .as("ending a membership also withdraws the period scheduled to follow it")
                .extracting(MembershipPeriodService.Period::startedOn, MembershipPeriodService.Period::endedOn)
                .containsExactly(tuple(LocalDate.of(2026, 1, 1), TODAY));
        assertThat(jdbc.sql("SELECT count(*) FROM domain_event WHERE subject_id = :id AND event_type = :type")
                .param("id", mary).param("type", "roster.membershipPeriod.removed").query(Long.class).single())
                .as("the withdrawn period is recorded in the audit log")
                .isEqualTo(1);
    }

    @Test
    void givenOnlyAPeriodScheduledAhead_whenTheRosterEndsTheMembership_thenItIsWithdrawn() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null, false);
        periods.add(mary, type.getId(), new MembershipPeriod(LocalDate.of(2026, 9, 1), null));

        // when
        roster.endMembership(mary);

        // then
        assertThat(periods.periodsOf(mary)).isEmpty();
    }

    @Test
    void givenAMembershipThatBeganToday_whenTheRosterEndsIt_thenItEndsWithoutInvertingItself() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null, false);
        roster.writeMembership(mary, type.getId(), MembershipPeriod.running());

        // when
        roster.endMembership(mary);

        // then
        assertThat(MemberFixtures.latestPeriodOf(members, mary))
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
        MembershipType retired = memberships.createMembershipType("Passive", null, false);
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
        MembershipType retired = memberships.createMembershipType("Passive", null, false);
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
        MembershipType type = memberships.createMembershipType("Adults", null, false);
        roster.writeMembership(mary, type.getId(),
                new MembershipPeriod(LocalDate.of(2026, 1, 1), null));

        // when
        RosterService.RosterEntry entry = roster.writeMembership(mary, type.getId(),
                new MembershipPeriod(LocalDate.of(2020, 9, 1), null));

        // then
        assertThat(entry.membership().startedOn()).isEqualTo(LocalDate.of(2020, 9, 1));
        assertThat(MemberFixtures.latestPeriodOf(members, mary))
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
    void whenAPeriodEndsOnTheDayItBegins_thenItCannotBeBuiltAtAll() {
        // when / then
        assertThatThrownBy(() ->
                new MembershipPeriod(LocalDate.of(2026, 5, 1), LocalDate.of(2026, 5, 1)))
                .isInstanceOf(InvalidMembershipPeriodException.class)
                .extracting("code")
                .as("the end is the first day without the membership, so this period would cover no day")
                .isEqualTo("membershipPeriod.coversNoDay");
    }

    @Test
    void givenNoMembership_whenTheRosterWritesOneEndingToday_thenItIsRefusedAndNothingIsStored() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null, false);

        // when / then
        assertThatThrownBy(() -> roster.writeMembership(mary, type.getId(), new MembershipPeriod(null, TODAY)))
                .isInstanceOf(InvalidMembershipPeriodException.class)
                .extracting("code")
                .as("a start that defaults to today and an end of today cover no day")
                .isEqualTo("membershipPeriod.coversNoDay");
        assertThat(MemberFixtures.latestPeriodOf(members, mary)).isEmpty();
    }

    @Test
    void givenAMembershipThatBeganToday_whenTheRosterCorrectsItsEndToToday_thenTheCorrectionIsRefused() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null, false);
        roster.writeMembership(mary, type.getId(), MembershipPeriod.running());

        // when / then
        assertThatThrownBy(() -> roster.writeMembership(mary, type.getId(), new MembershipPeriod(null, TODAY)))
                .isInstanceOf(InvalidMembershipPeriodException.class)
                .extracting("code")
                .isEqualTo("membershipPeriod.coversNoDay");
        assertThat(memberships.membershipTypeIdOf(mary)).as("the running period stays as it was")
                .contains(type.getId());
    }

    @Test
    void givenALegacyPeriodThatEndedOnTheDayItBegan_whenReadingAndAddingPeriods_thenItHoldsOnNoDayAndBlocksNothing() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null, false);
        jdbc.sql("""
                        INSERT INTO member (id, person_id, membership_type_id, started_on, ended_on)
                        VALUES (:id, :personId, :typeId, :day, :day)
                        """)
                .param("id", UUID.randomUUID())
                .param("personId", mary)
                .param("typeId", type.getId())
                .param("day", TODAY)
                .update();

        // when
        periods.add(mary, type.getId(), new MembershipPeriod(TODAY, null));

        // then
        assertThat(periods.periodsOf(mary)).as("both rows are listed").hasSize(2);
        assertThat(memberships.membershipTypeIdOf(mary)).contains(type.getId());
        assertThat(roster.person(mary).membership().current()).isTrue();
    }

    @Test
    void givenAWriteThatBypassesThePeriodType_whenItInvertsTheDates_thenTheDatabaseRefusesIt() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null, false);

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
        MembershipType type = memberships.createMembershipType("Adults", null, false);
        roster.writeMembership(mary, type.getId(),
                new MembershipPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 3, 31)));

        // when
        roster.endMembership(mary);

        // then
        assertThat(MemberFixtures.latestPeriodOf(members, mary))
                .get()
                .satisfies(member -> assertThat(member.getEndedOn())
                        .as("a second ending does not move the date to today")
                        .isEqualTo(LocalDate.of(2026, 3, 31)));
    }

    @Test
    void givenAMembershipThatEnded_whenTheSameTypeIsWrittenAgain_thenANewPeriodRunsFromTheNewStart() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null, false);
        roster.writeMembership(mary, type.getId(),
                new MembershipPeriod(LocalDate.of(2024, 1, 1), LocalDate.of(2024, 12, 31)));

        // when
        roster.writeMembership(mary, type.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), null));

        // then
        assertThat(memberships.membershipTypeIdOf(mary)).contains(type.getId());
        assertThat(members.findByPersonIdOrderByStartedOnAscIdAsc(mary))
                .as("a rejoin adds a period and keeps the earlier one")
                .extracting(Member::getStartedOn, Member::getEndedOn)
                .containsExactly(
                        tuple(LocalDate.of(2024, 1, 1), LocalDate.of(2024, 12, 31)),
                        tuple(LocalDate.of(2026, 1, 1), null));
    }

    @Test
    void givenAMembershipEndedOnTheWrongDate_whenTheDateIsCorrected_thenTheCorrectionHolds() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null, false);
        roster.writeMembership(mary, type.getId(),
                new MembershipPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 3, 31)));

        // when
        roster.writeMembership(mary, type.getId(),
                new MembershipPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 4, 30)));

        // then
        assertThat(MemberFixtures.latestPeriodOf(members, mary))
                .get()
                .satisfies(member ->
                        assertThat(member.getEndedOn()).isEqualTo(LocalDate.of(2026, 4, 30)));
    }

    @Test
    void givenAMembershipOnATypeTheClubRetired_whenCorrectingItsEndDate_thenItIsNotRefused() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType retired = memberships.createMembershipType("Passive", null, false);
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
        MembershipType running = memberships.createMembershipType("Adults", null, false);
        MembershipType retired = memberships.createMembershipType("Passive", null, false);
        roster.writeMembership(mary, running.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), null));
        memberships.setMembershipTypeActive(retired.getId(), false);

        // when / then
        assertThatThrownBy(() -> roster.writeMembership(
                mary, retired.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), null)))
                .isInstanceOf(MembershipTypeInactiveException.class);
        assertThat(memberships.membershipTypeIdOf(mary)).contains(running.getId());
    }

    @Test
    void givenARunningMembership_whenTheTypeChanges_thenTheOldTypeEndsTodayAndTheNewOneRunsFromToday() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType first = memberships.createMembershipType("Junior", null, false);
        MembershipType second = memberships.createMembershipType("Adults", null, false);
        roster.writeMembership(mary, first.getId(), new MembershipPeriod(LocalDate.of(2020, 9, 1), null));

        // when
        RosterService.RosterEntry entry = roster.writeMembership(mary, second.getId(),
                new MembershipPeriod(LocalDate.of(2020, 9, 1), null));

        // then
        assertThat(entry.membership().typeId()).isEqualTo(second.getId());
        assertThat(members.findByPersonIdOrderByStartedOnAscIdAsc(mary))
                .as("a type change keeps the years held on the old type as their own period")
                .extracting(Member::getMembershipTypeId, Member::getStartedOn, Member::getEndedOn)
                .containsExactly(
                        tuple(first.getId(), LocalDate.of(2020, 9, 1), TODAY),
                        tuple(second.getId(), TODAY, null));
    }

    @Test
    void givenAMembershipThatBeganToday_whenTheTypeChanges_thenThePeriodIsRetypedInPlace() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType first = memberships.createMembershipType("Junior", null, false);
        MembershipType second = memberships.createMembershipType("Adults", null, false);
        roster.writeMembership(mary, first.getId(), new MembershipPeriod(TODAY, null));

        // when
        roster.writeMembership(mary, second.getId(), new MembershipPeriod(TODAY, null));

        // then
        assertThat(members.findByPersonIdOrderByStartedOnAscIdAsc(mary))
                .as("a period that began today holds no day on the old type worth keeping")
                .extracting(Member::getMembershipTypeId, Member::getStartedOn, Member::getEndedOn)
                .containsExactly(tuple(second.getId(), TODAY, null));
    }

    @Test
    void givenAMembershipThatEnded_whenTheFormReopensIt_thenANewPeriodRunsFromTodayAndTheGapStays() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null, false);
        roster.writeMembership(mary, type.getId(),
                new MembershipPeriod(LocalDate.of(2020, 1, 1), LocalDate.of(2024, 1, 1)));

        // when
        roster.writeMembership(mary, type.getId(), new MembershipPeriod(LocalDate.of(2020, 1, 1), null));

        // then
        assertThat(memberships.membershipTypeIdOf(mary)).contains(type.getId());
        assertThat(members.findByPersonIdOrderByStartedOnAscIdAsc(mary))
                .as("taking somebody back keeps the years they were away")
                .extracting(Member::getStartedOn, Member::getEndedOn)
                .containsExactly(
                        tuple(LocalDate.of(2020, 1, 1), LocalDate.of(2024, 1, 1)),
                        tuple(TODAY, null));
    }

    @Test
    void givenARunningPeriodAndOneScheduledAhead_whenTheFormEndsTheMembership_thenTheScheduledOneIsWithdrawn() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType adults = memberships.createMembershipType("Adults", null, false);
        MembershipType passive = memberships.createMembershipType("Passive", null, false);
        periods.add(mary, adults.getId(), new MembershipPeriod(LocalDate.of(2025, 1, 1), LocalDate.of(2026, 12, 1)));
        periods.add(mary, passive.getId(), new MembershipPeriod(LocalDate.of(2026, 12, 1), null));

        // when
        roster.writeMembership(mary, adults.getId(), new MembershipPeriod(LocalDate.of(2025, 1, 1), TODAY));

        // then
        assertThat(periods.periodsOf(mary))
                .as("ending through the form withdraws the period scheduled to follow, as ending does")
                .extracting(MembershipPeriodService.Period::startedOn, MembershipPeriodService.Period::endedOn)
                .containsExactly(tuple(LocalDate.of(2025, 1, 1), TODAY));
        assertThat(jdbc.sql("SELECT count(*) FROM domain_event WHERE subject_id = :id AND event_type = :type")
                .param("id", mary).param("type", "roster.membershipPeriod.removed").query(Long.class).single())
                .as("the withdrawn period is recorded in the audit log")
                .isEqualTo(1);
    }

    @Test
    void givenARunningPeriodWithAGapBeforeAScheduledOne_whenTheFormMovesItsEndLater_thenTheScheduledOneStays() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null, false);
        periods.add(mary, type.getId(), new MembershipPeriod(LocalDate.of(2025, 1, 1), LocalDate.of(2026, 8, 1)));
        periods.add(mary, type.getId(), new MembershipPeriod(LocalDate.of(2026, 12, 1), null));

        // when
        roster.writeMembership(mary, type.getId(),
                new MembershipPeriod(LocalDate.of(2025, 1, 1), LocalDate.of(2026, 9, 1)));

        // then
        assertThat(periods.periodsOf(mary))
                .as("a later end shortens nothing, so nothing scheduled is withdrawn")
                .extracting(MembershipPeriodService.Period::startedOn, MembershipPeriodService.Period::endedOn)
                .containsExactly(
                        tuple(LocalDate.of(2025, 1, 1), LocalDate.of(2026, 9, 1)),
                        tuple(LocalDate.of(2026, 12, 1), null));
    }

    @Test
    void givenAMembershipThatEnded_whenSearchingForCoPlayers_thenThePersonIsNotOffered() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null, false);
        roster.writeMembership(mary, type.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), null));
        assertThat(memberships.findParticipants("major", null)).isNotEmpty();

        // when
        roster.endMembership(mary);

        // then
        assertThat(memberships.findParticipants("major", null)).isEmpty();
    }

    @Test
    void givenARunningMembership_whenTheRosterEndsIt_thenItEndsOnTheClubsToday() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null, false);
        roster.writeMembership(mary, type.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), null));

        // when
        roster.endMembership(mary);

        // then
        assertThat(MemberFixtures.latestPeriodOf(members, mary))
                .get()
                .satisfies(member -> assertThat(member.getEndedOn()).isEqualTo(TODAY));
    }

    @Test
    void givenAMembershipWrittenWithoutAStart_whenReadingIt_thenItBeganOnTheClubsToday() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType type = memberships.createMembershipType("Adults", null, false);

        // when
        RosterService.RosterEntry entry =
                roster.writeMembership(mary, type.getId(), MembershipPeriod.running());

        // then
        assertThat(entry.membership().startedOn()).isEqualTo(TODAY);
        assertThat(entry.membership().endedOn()).isNull();
    }
}
