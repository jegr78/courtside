package org.courtside.rules.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubTimeZone;
import org.courtside.rules.BookingHoursLimit;
import org.courtside.rules.BookingWindow;
import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleViolation;
import org.springframework.stereotype.Component;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class BookingHoursRule implements BookingRule {

    private final BookingHoursLimit limit;
    private final ClubTimeZone timeZone;

    @Override
    public List<RuleViolation> check(RuleContext context) {
        return check(context, limit.windowFor(context.membershipTypeId()));
    }

    // A move can carry a booking out of the window just as a new booking can start outside it.
    @Override
    public boolean appliesToAMove() {
        return true;
    }

    @Override
    public Prepared prepare() {
        Map<UUID, Optional<BookingWindow>> windowByMembership = new HashMap<>();
        return context -> check(context, windowByMembership.computeIfAbsent(
                context.membershipTypeId(), limit::windowFor));
    }

    private List<RuleViolation> check(RuleContext context, Optional<BookingWindow> window) {
        if (window.isEmpty()) {
            return List.of();
        }
        ZoneId zone = timeZone.zoneId();
        ZonedDateTime start = context.slot().start().atZone(zone);
        ZonedDateTime end = context.slot().end().atZone(zone);
        if (start.toLocalDate().equals(end.toLocalDate())
                && window.get().covers(start.toLocalTime(), end.toLocalTime())) {
            return List.of();
        }
        return List.of(new RuleViolation("booking.rule.bookingHours.outside",
                Map.of("earliestStart", window.get().earliestStart().toString(),
                        "latestEnd", window.get().latestEnd().toString())));
    }
}
