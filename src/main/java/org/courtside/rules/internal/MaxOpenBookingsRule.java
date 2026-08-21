package org.courtside.rules.internal;

import org.courtside.rules.BookingCounter;
import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleType;
import org.courtside.rules.RuleViolation;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.LongSupplier;

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
        return check(context, limit, () -> bookingCounter.countOpenBookingsOf(
                context.userAccountId(), clock.instant()));
    }

    @Override
    public Prepared prepare() {
        Map<UUID, Optional<Integer>> limitsByMembership = new HashMap<>();
        Map<UUID, Long> countsByAccount = new HashMap<>();
        return context -> check(context, limitsByMembership.computeIfAbsent(
                        context.membershipTypeId(), membershipTypeId -> ruleParameters.findIntParameter(
                                membershipTypeId, RuleType.MAX_OPEN_BOOKINGS, "limit")),
                () -> countsByAccount.computeIfAbsent(context.userAccountId(),
                        accountId -> bookingCounter.countOpenBookingsOf(accountId, clock.instant())));
    }

    private List<RuleViolation> check(RuleContext context, Optional<Integer> limit,
                                      LongSupplier currentBookings) {
        if (limit.isEmpty()) {
            return List.of();
        }

        long current = currentBookings.getAsLong();
        if (current >= limit.get()) {
            return List.of(new RuleViolation("booking.rule.maxOpenBookings.exceeded",
                    Map.of("limit", limit.get(), "current", current)));
        }
        return List.of();
    }
}
