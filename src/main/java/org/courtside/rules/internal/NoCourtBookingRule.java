package org.courtside.rules.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.rules.CourtBookingPermission;
import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleViolation;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class NoCourtBookingRule implements BookingRule {

    private final CourtBookingPermission permission;

    @Override
    public List<RuleViolation> check(RuleContext context) {
        return permission.violationsFor(context.membershipTypeId());
    }

    // Reshaping court time somebody may not hold is the same question as taking it in the first
    // place, so a move has to ask it too.
    @Override
    public boolean appliesToAMove() {
        return true;
    }

    @Override
    public Prepared prepare() {
        Map<UUID, List<RuleViolation>> violationsByMembership = new HashMap<>();
        return context -> violationsByMembership.computeIfAbsent(context.membershipTypeId(),
                permission::violationsFor);
    }
}
