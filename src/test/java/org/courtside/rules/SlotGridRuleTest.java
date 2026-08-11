package org.courtside.rules;

import org.courtside.rules.internal.SlotGridRule;
import org.courtside.shared.TimeSlot;
import org.courtside.config.BookingSlotDuration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class SlotGridRuleTest {

    private final SlotGridRule rule = new SlotGridRule(
            () -> new BookingSlotDuration(30), "Europe/Berlin");

    @Test
    void givenAThirtyMinuteGrid_whenBookingAlignedToIt_thenNoViolation() {
        // when
        var violations = rule.check(
                contextFor("2026-05-12T18:00:00+02:00", "2026-05-12T19:30:00+02:00"));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenAThirtyMinuteGrid_whenBookingStartsAtTenPast_thenMisalignedViolation() {
        // when
        var violations = rule.check(
                contextFor("2026-05-12T18:10:00+02:00", "2026-05-12T19:10:00+02:00"));

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.slotGrid.misaligned");
    }

    @Test
    void givenAThirtyMinuteGrid_whenBookingLastsFortyMinutes_thenDurationViolation() {
        // when
        var violations = rule.check(
                contextFor("2026-05-12T18:00:00+02:00", "2026-05-12T18:40:00+02:00"));

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.slotGrid.duration");
    }

    @Test
    void givenTheClubChangesItsGrid_whenCheckingTheNextBooking_thenTheCurrentSettingIsUsed() {
        // given
        AtomicInteger slotMinutes = new AtomicInteger(30);
        SlotGridRule changingRule = new SlotGridRule(
                () -> new BookingSlotDuration(slotMinutes.get()), "Europe/Berlin");
        slotMinutes.set(15);

        // when
        var violations = changingRule.check(
                contextFor("2026-05-12T18:15:00+02:00", "2026-05-12T19:00:00+02:00"));

        // then
        assertThat(violations).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({
            "75, 01:15:00, 02:30:00, 01:00:00, 02:15:00",
            "90, 01:30:00, 03:00:00, 01:00:00, 02:30:00",
            "120, 02:00:00, 04:00:00, 01:00:00, 03:00:00"
    })
    void givenAGridLongerThanAnHour_whenCheckingStarts_thenLocalMidnightDefinesAlignment(
            int minutes, String alignedStart, String alignedEnd,
            String misalignedStart, String misalignedEnd) {
        // given
        SlotGridRule longGridRule = new SlotGridRule(
                () -> new BookingSlotDuration(minutes), "Europe/Berlin");

        // when
        var aligned = longGridRule.check(contextFor(
                "2026-05-12T" + alignedStart + "+02:00",
                "2026-05-12T" + alignedEnd + "+02:00"));
        var misaligned = longGridRule.check(contextFor(
                "2026-05-12T" + misalignedStart + "+02:00",
                "2026-05-12T" + misalignedEnd + "+02:00"));

        // then
        assertThat(aligned).isEmpty();
        assertThat(misaligned).extracting(RuleViolation::code)
                .containsExactly("booking.rule.slotGrid.misaligned");
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
