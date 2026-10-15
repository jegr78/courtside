package org.courtside.rules.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.rules.RuleType;
import org.courtside.rules.WeeklyHoursLimit;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class WeeklyHoursLimitService implements WeeklyHoursLimit {

    private final RuleParameterRepository ruleParameters;

    @Override
    public Optional<Integer> maxHoursFor(UUID membershipTypeId) {
        return ruleParameters.findIntParameter(membershipTypeId, RuleType.WEEKLY_BOOKED_HOURS, "maxHours");
    }
}
