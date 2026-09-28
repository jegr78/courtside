package org.courtside.rules;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.rules.internal.BookingRule;
import org.courtside.rules.internal.OpeningHoursRule;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import(FacilityTestFixture.class)
class OpeningHoursRuleTest extends AbstractIntegrationTest {

    @Autowired
    private OpeningHoursRule rule;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @BeforeEach
    void setUp() {
        facilityFixture.setOpeningHours(DayOfWeek.TUESDAY, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
    }

    @Test
    void givenOpeningHoursOnTuesday_whenBookingWithinThem_thenNoViolation() {
        // when
        var violations = rule.check(
                contextFor("2026-05-12T18:00:00+02:00", "2026-05-12T19:00:00+02:00"));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenOpeningHoursFromEight_whenBookingStartsAtSeven_thenOutsideViolation() {
        // when
        var violations = rule.check(
                contextFor("2026-05-12T07:00:00+02:00", "2026-05-12T08:30:00+02:00"));

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.openingHours.outside");
    }

    @Test
    void givenOpeningHoursUntilTen_whenBookingEndsAfterThat_thenOutsideViolation() {
        // when
        var violations = rule.check(
                contextFor("2026-05-12T21:30:00+02:00", "2026-05-12T22:30:00+02:00"));

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.openingHours.outside");
    }

    @Test
    void givenNoOpeningHoursOnWednesday_whenBookingThatDay_thenClosedViolation() {
        // when
        var violations = rule.check(
                contextFor("2026-05-13T18:00:00+02:00", "2026-05-13T19:00:00+02:00"));

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.openingHours.closed");
    }

    @Test
    void givenOpeningHoursUntilTen_whenBookingRunsPastMidnight_thenOutsideViolation() {
        // when
        var violations = rule.check(
                contextFor("2026-05-12T21:00:00+02:00", "2026-05-13T01:00:00+02:00"));

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.openingHours.outside");
    }

    @Test
    void givenOpeningHoursUntilTen_whenBookingSpansAWholeWeek_thenOutsideViolation() {
        // when
        var violations = rule.check(
                contextFor("2026-05-12T21:00:00+02:00", "2026-05-19T21:00:00+02:00"));

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.openingHours.outside");
    }

    @Test
    void givenOpeningHoursUntilTen_whenBookingEndsExactlyAtClosingTime_thenNoViolation() {
        // when
        var violations = rule.check(
                contextFor("2026-05-12T21:00:00+02:00", "2026-05-12T22:00:00+02:00"));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenWinterHoursFromNovember_whenOneBatchChecksATuesdayOnEitherSide_thenEachUsesTheWeekInForceOnIt() {
        // given
        facilityFixture.scheduleOpeningHours(LocalDate.of(2026, 11, 1),
                Map.of(DayOfWeek.TUESDAY, new OpeningWindow(LocalTime.of(10, 0), LocalTime.of(18, 0))));
        BookingRule.Prepared batch = rule.prepare();

        // when
        var october = batch.check(contextFor("2026-10-27T19:00:00+01:00", "2026-10-27T20:00:00+01:00"));
        var november = batch.check(contextFor("2026-11-03T19:00:00+01:00", "2026-11-03T20:00:00+01:00"));

        // then
        assertThat(october).as("October still has the summer window until 22:00").isEmpty();
        assertThat(november).extracting(RuleViolation::code)
                .as("the winter week closes at 18:00").containsExactly("booking.rule.openingHours.outside");
    }

    private RuleContext contextFor(String start, String end) {
        return new RuleContext(
                UUID.randomUUID(),
                UUID.randomUUID(),
                new TimeSlot(Instant.parse(start), Instant.parse(end)),
                UUID.randomUUID(),
                null);
    }
}
