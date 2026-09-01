package org.courtside.rules.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.rules.CancellationDeadline;
import org.courtside.rules.RuleType;
import org.courtside.rules.RuleViolation;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class CancellationDeadlineService implements CancellationDeadline {

    private final RuleParameterRepository ruleParameters;

    @Override
    public Optional<RuleViolation> violationFor(
            UUID membershipTypeId, Instant startsAt, Instant cancelledAt) {
        return ruleParameters.findIntParameter(
                        membershipTypeId, RuleType.CANCELLATION_DEADLINE, "minMinutes")
                .filter(minMinutes -> cancelledAt.isAfter(
                        startsAt.minus(minMinutes, ChronoUnit.MINUTES)))
                .map(minMinutes -> new RuleViolation(
                        "booking.rule.cancellationDeadline.exceeded",
                        Map.of("minMinutes", minMinutes)));
    }
}
