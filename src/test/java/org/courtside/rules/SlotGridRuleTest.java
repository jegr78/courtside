package org.courtside.rules;

import org.courtside.rules.internal.SlotGridRule;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class SlotGridRuleTest {

    private final SlotGridRule rule = new SlotGridRule(30, "Europe/Berlin");

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

    private RuleContext contextFor(String start, String end) {
        return new RuleContext(
                UUID.randomUUID(),
                UUID.randomUUID(),
                new TimeSlot(Instant.parse(start), Instant.parse(end)),
                UUID.randomUUID(),
                null);
    }
}
