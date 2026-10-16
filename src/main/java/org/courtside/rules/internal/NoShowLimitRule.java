package org.courtside.rules.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.rules.BookingCounter;
import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleType;
import org.courtside.rules.RuleViolation;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class NoShowLimitRule implements BookingRule {

    private final RuleParameterRepository ruleParameters;
    private final BookingCounter bookingCounter;
    private final Clock clock;

    @Override
    public List<RuleViolation> check(RuleContext context) {
        return limitFor(context.membershipTypeId())
                .map(limit -> check(context, limit, noShowsOf(context.userAccountId(), limit)))
                .orElse(List.of());
    }

    @Override
    public Prepared prepare() {
        Map<UUID, Optional<Limit>> limits = new HashMap<>();
        Map<UUID, Long> noShows = new HashMap<>();
        return context -> limits.computeIfAbsent(context.membershipTypeId(), this::limitFor)
                .map(limit -> check(context, limit, context.userAccountId() == null ? 0
                        : noShows.computeIfAbsent(context.userAccountId(), account -> noShowsOf(account, limit))))
                .orElse(List.of());
    }

    private List<RuleViolation> check(RuleContext context, Limit limit, long noShows) {
        if (context.userAccountId() == null || noShows < limit.maxNoShows()) {
            return List.of();
        }
        return List.of(new RuleViolation("booking.rule.noShowLimit.reached",
                Map.of("maxNoShows", limit.maxNoShows(), "windowDays", limit.windowDays(), "noShows", noShows)));
    }

    private long noShowsOf(UUID accountId, Limit limit) {
        return accountId == null ? 0
                : bookingCounter.countNoShowsSince(accountId, clock.instant().minus(Duration.ofDays(limit.windowDays())));
    }

    private Optional<Limit> limitFor(UUID membershipTypeId) {
        return ruleParameters.findIntParameter(membershipTypeId, RuleType.NO_SHOW_LIMIT, "maxNoShows")
                .flatMap(maxNoShows -> ruleParameters.findIntParameter(
                                membershipTypeId, RuleType.NO_SHOW_LIMIT, "windowDays")
                        .map(windowDays -> new Limit(maxNoShows, windowDays)));
    }

    private record Limit(int maxNoShows, int windowDays) {
    }
}
