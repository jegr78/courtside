package org.courtside.rules.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.rules.BookingHoursLimit;
import org.courtside.rules.BookingWindow;
import org.courtside.rules.RuleType;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class BookingHoursService implements BookingHoursLimit {

    private final RuleParameterRepository ruleParameters;

    @Override
    public Optional<BookingWindow> windowFor(UUID membershipTypeId) {
        return ruleParameters.findIntParameter(membershipTypeId, RuleType.BOOKING_HOURS, "earliestStart")
                .flatMap(earliestStart -> ruleParameters.findIntParameter(
                                membershipTypeId, RuleType.BOOKING_HOURS, "latestEnd")
                        .map(latestEnd -> BookingWindow.ofMinutesOfDay(earliestStart, latestEnd)));
    }
}
