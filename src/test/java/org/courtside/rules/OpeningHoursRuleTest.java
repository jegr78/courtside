package org.courtside.rules;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.OpeningHours;
import org.courtside.facility.OpeningHoursRepository;
import org.courtside.shared.OpeningWindow;
import org.courtside.rules.internal.OpeningHoursRule;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class OpeningHoursRuleTest extends AbstractIntegrationTest {

    @Autowired
    private OpeningHoursRule rule;

    @Autowired
    private OpeningHoursRepository openingHours;

    @BeforeEach
    void setUp() {
        openingHours.save(new OpeningHours(DayOfWeek.TUESDAY, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
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

    private RuleContext contextFor(String start, String end) {
        return new RuleContext(
                UUID.randomUUID(),
                UUID.randomUUID(),
                new TimeSlot(Instant.parse(start), Instant.parse(end)),
                UUID.randomUUID(),
                null);
    }
}
