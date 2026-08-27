package org.courtside.rules.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.rules.BookingDurationLimit;
import org.courtside.rules.RuleType;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class BookingDurationLimitService implements BookingDurationLimit {

    private final RuleParameterRepository ruleParameters;

    @Override
    public Optional<Integer> maxMinutesFor(UUID membershipTypeId) {
        return ruleParameters.findIntParameter(
                membershipTypeId, RuleType.MAX_BOOKING_DURATION, "maxMinutes");
    }
}
