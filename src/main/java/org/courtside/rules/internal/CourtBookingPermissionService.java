package org.courtside.rules.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.rules.CourtBookingPermission;
import org.courtside.rules.RuleType;
import org.courtside.rules.RuleViolation;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class CourtBookingPermissionService implements CourtBookingPermission {

    private static final List<RuleViolation> BARRED =
            List.of(new RuleViolation("booking.rule.noCourtBooking", Map.of()));

    private final RuleParameterRepository ruleParameters;

    @Override
    public List<RuleViolation> violationsFor(UUID membershipTypeId) {
        return ruleParameters.carriesRule(membershipTypeId, RuleType.NO_COURT_BOOKING)
                ? BARRED
                : List.of();
    }
}
