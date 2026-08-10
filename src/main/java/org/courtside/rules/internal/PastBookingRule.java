package org.courtside.rules.internal;

import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleViolation;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.util.List;
import java.util.Map;

@Component
@RequiredArgsConstructor
public class PastBookingRule implements BookingRule {

    private final Clock clock;

    @Override
    public boolean isOverridable() {
        return false;
    }

    @Override
    public List<RuleViolation> check(RuleContext context) {
        if (context.slot().start().isBefore(clock.instant())) {
            return List.of(new RuleViolation("booking.rule.startsInPast", Map.of()));
        }
        return List.of();
    }
}
