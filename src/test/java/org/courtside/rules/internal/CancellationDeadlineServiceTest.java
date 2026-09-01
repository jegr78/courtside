package org.courtside.rules.internal;

import org.courtside.rules.RuleType;
import org.courtside.rules.RuleViolation;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class CancellationDeadlineServiceTest {

    private static final UUID MEMBERSHIP_TYPE = UUID.randomUUID();
    private static final Instant START = Instant.parse("2026-08-10T16:00:00Z");

    private final RuleParameterRepository parameters = mock(RuleParameterRepository.class);
    private final CancellationDeadlineService deadline = new CancellationDeadlineService(parameters);

    @Test
    void givenNoDeadline_whenCheckingCancellation_thenItIsAllowed() {
        // given
        when(parameters.findIntParameter(
                MEMBERSHIP_TYPE, RuleType.CANCELLATION_DEADLINE, "minMinutes"))
                .thenReturn(Optional.empty());

        // when / then
        assertThat(deadline.violationFor(MEMBERSHIP_TYPE, START, START)).isEmpty();
    }

    @Test
    void givenTheDeadlineHasNotPassed_whenCheckingCancellation_thenItIsAllowed() {
        // given
        when(parameters.findIntParameter(
                MEMBERSHIP_TYPE, RuleType.CANCELLATION_DEADLINE, "minMinutes"))
                .thenReturn(Optional.of(60));

        // when / then
        assertThat(deadline.violationFor(
                MEMBERSHIP_TYPE, START, Instant.parse("2026-08-10T15:00:00Z"))).isEmpty();
    }

    @Test
    void givenTheDeadlineHasPassed_whenCheckingCancellation_thenItReportsTheRule() {
        // given
        when(parameters.findIntParameter(
                MEMBERSHIP_TYPE, RuleType.CANCELLATION_DEADLINE, "minMinutes"))
                .thenReturn(Optional.of(60));

        // when
        Optional<RuleViolation> violation = deadline.violationFor(
                MEMBERSHIP_TYPE, START, Instant.parse("2026-08-10T15:00:01Z"));

        // then
        assertThat(violation).contains(new RuleViolation(
                "booking.rule.cancellationDeadline.exceeded", Map.of("minMinutes", 60)));
    }
}
