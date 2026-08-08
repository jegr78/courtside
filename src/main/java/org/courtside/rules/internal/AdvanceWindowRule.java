package org.courtside.rules.internal;

import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleViolation;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Component
@RequiredArgsConstructor
public class AdvanceWindowRule implements BookingRule {

    private final RuleParameterRepository ruleParameters;
    private final Clock clock;

    @Override
    public List<RuleViolation> check(RuleContext context) {
        Optional<Integer> maxDays = ruleParameters.findIntParameter(
                context.membershipTypeId(), RuleType.ADVANCE_WINDOW, "maxDays");
        if (maxDays.isEmpty()) {
            return List.of();
        }

        Duration ahead = Duration.between(clock.instant(), context.slot().start());
        if (ahead.toDays() >= maxDays.get()) {
            return List.of(new RuleViolation("booking.rule.advanceWindow.exceeded",
                    Map.of("maxDays", maxDays.get())));
        }
        return List.of();
    }
}
