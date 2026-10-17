package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.internal.MembershipPeriodNotFoundException;
import org.courtside.member.internal.MembershipPeriodsOverlapException;
import org.courtside.member.internal.MembershipType;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import(IdentityTestFixture.class)
class MembershipPeriodTest extends AbstractIntegrationTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 5, 12);

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberService memberships;

    @Autowired
    private MembershipPeriodService periods;

    @Test
    void givenAPeriodThatBeginsTomorrow_whenAskingWhichTypeBindsThePersonToday_thenNoneDoes() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType adults = memberships.createMembershipType("Adults", null, false);

        // when
        periods.add(mary, adults.getId(), new MembershipPeriod(TODAY.plusDays(1), null));

        // then
        assertThat(memberships.membershipTypeIdOf(mary))
                .as("a period that has not begun grants nothing yet")
                .isEmpty();
        assertThat(periods.periodsOf(mary)).singleElement()
                .satisfies(period -> assertThat(period.startedOn()).isEqualTo(TODAY.plusDays(1)));
    }

    @Test
    void givenAPeriodThatEndsToday_whenAskingWhichTypeBindsThePersonToday_thenNoneDoes() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType adults = memberships.createMembershipType("Adults", null, false);

        // when
        periods.add(mary, adults.getId(), new MembershipPeriod(TODAY.minusYears(1), TODAY));

        // then
        assertThat(memberships.membershipTypeIdOf(mary))
                .as("the end date is the first day the membership no longer holds")
                .isEmpty();
    }

    @Test
    void givenAPeriodThatEndsTomorrow_whenAskingWhichTypeBindsThePersonToday_thenItStillDoes() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType adults = memberships.createMembershipType("Adults", null, false);

        // when
        periods.add(mary, adults.getId(), new MembershipPeriod(TODAY.minusYears(1), TODAY.plusDays(1)));

        // then
        assertThat(memberships.membershipTypeIdOf(mary)).contains(adults.getId());
    }

    @Test
    void givenAPeriodEndingOnTheDayTheNextBegins_whenAddingBoth_thenTheyDoNotOverlap() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType youth = memberships.createMembershipType("Juniors", null, false);
        MembershipType adults = memberships.createMembershipType("Adults", null, false);
        periods.add(mary, youth.getId(), new MembershipPeriod(LocalDate.of(2020, 1, 1), TODAY));

        // when
        periods.add(mary, adults.getId(), new MembershipPeriod(TODAY, null));

        // then
        assertThat(memberships.membershipTypeIdOf(mary)).contains(adults.getId());
    }

    @Test
    void givenAPeriodEndingInDecember_whenAskingToday_thenItBindsUntilThen() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType adults = memberships.createMembershipType("Adults", null, false);

        // when
        periods.add(mary, adults.getId(), new MembershipPeriod(TODAY.minusYears(1), LocalDate.of(2026, 12, 31)));

        // then
        assertThat(memberships.membershipTypeIdOf(mary)).contains(adults.getId());
    }

    @Test
    void givenAPastPeriodOfOneTypeAndARunningOneOfAnother_whenAskingToday_thenTheRunningTypeBindsAndBothStay() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType youth = memberships.createMembershipType("Juniors", null, false);
        MembershipType adults = memberships.createMembershipType("Adults", null, false);

        // when
        periods.add(mary, youth.getId(), new MembershipPeriod(LocalDate.of(2020, 1, 1), LocalDate.of(2025, 12, 31)));
        periods.add(mary, adults.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), null));

        // then
        assertThat(memberships.membershipTypeIdOf(mary)).contains(adults.getId());
        assertThat(periods.periodsOf(mary))
                .as("the history keeps every period, oldest first")
                .extracting(MembershipPeriodService.Period::membershipTypeId)
                .containsExactly(youth.getId(), adults.getId());
    }

    @Test
    void givenARunningPeriod_whenAddingOneThatOverlapsIt_thenTheOverlapIsRefused() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType adults = memberships.createMembershipType("Adults", null, false);
        periods.add(mary, adults.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), null));

        // when / then
        assertThatThrownBy(() -> periods.add(mary, adults.getId(),
                new MembershipPeriod(TODAY.plusMonths(1), null)))
                .isInstanceOf(MembershipPeriodsOverlapException.class)
                .extracting("code")
                .isEqualTo("membershipPeriod.overlaps");
        assertThat(periods.periodsOf(mary)).hasSize(1);
    }

    @Test
    void givenAPeriodRecordedWithTheWrongType_whenCorrectingIt_thenEveryFieldTakesTheNewValue() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType youth = memberships.createMembershipType("Juniors", null, false);
        MembershipType adults = memberships.createMembershipType("Adults", null, false);
        UUID periodId = periods.add(mary, youth.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), null)).id();

        // when
        periods.correct(mary, periodId, adults.getId(),
                new MembershipPeriod(LocalDate.of(2026, 2, 1), LocalDate.of(2026, 9, 30)));

        // then
        assertThat(periods.periodsOf(mary)).singleElement().isEqualTo(new MembershipPeriodService.Period(
                periodId, adults.getId(), LocalDate.of(2026, 2, 1), LocalDate.of(2026, 9, 30)));
    }

    @Test
    void givenTwoPeriods_whenCorrectingOneSoThatItOverlapsTheOther_thenTheCorrectionIsRefused() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType adults = memberships.createMembershipType("Adults", null, false);
        UUID earlier = periods.add(mary, adults.getId(),
                new MembershipPeriod(LocalDate.of(2024, 1, 1), LocalDate.of(2024, 12, 31))).id();
        periods.add(mary, adults.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), null));

        // when / then
        assertThatThrownBy(() -> periods.correct(mary, earlier, adults.getId(),
                new MembershipPeriod(LocalDate.of(2024, 1, 1), LocalDate.of(2026, 3, 1))))
                .isInstanceOf(MembershipPeriodsOverlapException.class);
        assertThat(periods.periodsOf(mary)).first()
                .satisfies(period -> assertThat(period.endedOn()).isEqualTo(LocalDate.of(2024, 12, 31)));
    }

    @Test
    void givenAPeriod_whenRemovingIt_thenThePersonHoldsNoMembership() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType adults = memberships.createMembershipType("Adults", null, false);
        UUID periodId = periods.add(mary, adults.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), null)).id();

        // when
        periods.remove(mary, periodId);

        // then
        assertThat(periods.periodsOf(mary)).isEmpty();
        assertThat(memberships.membershipTypeIdOf(mary)).isEmpty();
    }

    @Test
    void givenAPeriodOfAnotherPerson_whenRemovingItThroughThisPerson_thenItIsNotFound() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        UUID john = identity.createPerson("John", "Roe", "john.roe@example.org");
        MembershipType adults = memberships.createMembershipType("Adults", null, false);
        UUID marysPeriod = periods.add(mary, adults.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), null)).id();

        // when / then
        assertThatThrownBy(() -> periods.remove(john, marysPeriod))
                .isInstanceOf(MembershipPeriodNotFoundException.class);
        assertThat(periods.periodsOf(mary)).hasSize(1);
    }

    @Test
    void whenAddingAPeriodWithoutAStart_thenItIsRefused() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType adults = memberships.createMembershipType("Adults", null, false);

        // when / then
        assertThatThrownBy(() -> periods.add(mary, adults.getId(), new MembershipPeriod(null, null)))
                .isInstanceOf(InvalidMembershipPeriodException.class)
                .extracting("code")
                .isEqualTo("membershipPeriod.startRequired");
    }

    @Test
    void whenAddingAPeriodThatEndsOnItsFirstDay_thenItIsRefused() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        MembershipType adults = memberships.createMembershipType("Adults", null, false);

        // when / then
        assertThatThrownBy(() -> periods.add(mary, adults.getId(), new MembershipPeriod(TODAY, TODAY)))
                .isInstanceOf(InvalidMembershipPeriodException.class)
                .extracting("code")
                .isEqualTo("membershipPeriod.coversNoDay");
        assertThat(periods.periodsOf(mary)).isEmpty();
    }
}
