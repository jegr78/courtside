package org.courtside.rules;

import org.courtside.rules.internal.PastBookingRule;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class PastBookingRuleTest {

    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");

    private final PastBookingRule rule = new PastBookingRule(
            Clock.fixed(NOW, ZoneOffset.UTC));

    @Test
    void givenABookingStartingBeforeNow_whenChecking_thenItIsRejected() {
        // when
        var violations = rule.check(contextFor(NOW.minus(1, ChronoUnit.NANOS)));

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.startsInPast");
    }

    @Test
    void givenABookingStartingExactlyNow_whenChecking_thenItIsAllowed() {
        // when
        var violations = rule.check(contextFor(NOW));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void whenCheckingWhetherTheRuleIsOverridable_thenItIsNot() {
        // when / then
        assertThat(rule.isOverridable()).isFalse();
    }

    private RuleContext contextFor(Instant start) {
        return new RuleContext(
                UUID.randomUUID(),
                UUID.randomUUID(),
                new TimeSlot(start, start.plus(1, ChronoUnit.HOURS)),
                UUID.randomUUID(),
                null);
    }
}
