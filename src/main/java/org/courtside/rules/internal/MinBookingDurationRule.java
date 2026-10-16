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
public class MinBookingDurationRule implements BookingRule {

    private final BookingDurationLimit limit;

    @Override
    public List<RuleViolation> check(RuleContext context) {
        return check(context, limit.minMinutesFor(context.membershipTypeId()));
    }

    // A move may shorten a booking, so a bound that skips it is no bound.
    @Override
    public boolean appliesToAMove() {
        return true;
    }

    @Override
    public Prepared prepare() {
        Map<UUID, Optional<Integer>> minMinutesByMembership = new HashMap<>();
        return context -> check(context, minMinutesByMembership.computeIfAbsent(
                context.membershipTypeId(), limit::minMinutesFor));
    }

    private List<RuleViolation> check(RuleContext context, Optional<Integer> minMinutes) {
        if (minMinutes.isEmpty()
                || context.slot().duration().compareTo(Duration.ofMinutes(minMinutes.get())) >= 0) {
            return List.of();
        }
        return List.of(new RuleViolation("booking.rule.minBookingDuration.notReached",
                Map.of("minMinutes", minMinutes.get())));
    }
}
