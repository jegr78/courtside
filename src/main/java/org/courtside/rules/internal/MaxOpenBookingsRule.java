package org.courtside.rules.internal;

import org.courtside.rules.BookingCounter;
import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleViolation;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Component
@RequiredArgsConstructor
public class MaxOpenBookingsRule implements BookingRule {

    private final RuleParameterRepository ruleParameters;
    private final BookingCounter bookingCounter;
    private final Clock clock;

    @Override
    public List<RuleViolation> check(RuleContext context) {
        Optional<Integer> limit = ruleParameters.findIntParameter(
                context.membershipTypeId(), RuleType.MAX_OPEN_BOOKINGS, "limit");
        if (limit.isEmpty()) {
            return List.of();
        }

        long current = bookingCounter.countOpenBookingsOf(context.userAccountId(), clock.instant());
        if (current >= limit.get()) {
            return List.of(new RuleViolation("booking.rule.maxOpenBookings.exceeded",
                    Map.of("limit", limit.get(), "current", current)));
        }
        return List.of();
    }
}
