package org.courtside.rules.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleType;
import org.courtside.rules.RuleViolation;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class NoCourtBookingRule implements BookingRule {

    private static final List<RuleViolation> BARRED =
            List.of(new RuleViolation("booking.rule.noCourtBooking", Map.of()));

    private final RuleParameterRepository ruleParameters;

    @Override
    public List<RuleViolation> check(RuleContext context) {
        return barred(ruleParameters.carriesRule(context.membershipTypeId(),
                RuleType.NO_COURT_BOOKING));
    }

    // Reshaping court time somebody may not hold is the same question as taking it in the first
    // place, so a move has to ask it too.
    @Override
    public boolean appliesToAMove() {
        return true;
    }

    @Override
    public Prepared prepare() {
        Map<UUID, Boolean> barsByMembership = new HashMap<>();
        return context -> barred(barsByMembership.computeIfAbsent(context.membershipTypeId(),
                membershipTypeId -> ruleParameters.carriesRule(
                        membershipTypeId, RuleType.NO_COURT_BOOKING)));
    }

    private static List<RuleViolation> barred(boolean bars) {
        return bars ? BARRED : List.of();
    }
}
