package org.courtside.rules.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.rules.BookingDurationLimit;
import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleViolation;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class MaxBookingDurationRule implements BookingRule {

    private final BookingDurationLimit limit;

    @Override
    public List<RuleViolation> check(RuleContext context) {
        return check(context, limit.maxMinutesFor(context.membershipTypeId()));
    }

    // A move may lengthen a booking, so a bound that skips it is no bound.
    @Override
    public boolean appliesToAMove() {
        return true;
    }

    @Override
    public Prepared prepare() {
        Map<UUID, Optional<Integer>> maxMinutesByMembership = new HashMap<>();
        return context -> check(context, maxMinutesByMembership.computeIfAbsent(
                context.membershipTypeId(), limit::maxMinutesFor));
    }

    private List<RuleViolation> check(RuleContext context, Optional<Integer> maxMinutes) {
        if (maxMinutes.isEmpty()) {
            return List.of();
        }
        // Compared as a Duration rather than as whole minutes: toMinutes() truncates, so a booking
        // carrying seconds would measure short against a bound this rule is the only one holding.
        if (context.slot().duration().compareTo(Duration.ofMinutes(maxMinutes.get())) > 0) {
            return List.of(new RuleViolation("booking.rule.maxBookingDuration.exceeded",
                    Map.of("maxMinutes", maxMinutes.get())));
        }
        return List.of();
    }
}
