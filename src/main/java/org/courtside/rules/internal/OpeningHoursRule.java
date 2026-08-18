package org.courtside.rules.internal;

import org.courtside.facility.FacilityService;
import org.courtside.facility.OpeningHours;
import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleViolation;
import org.courtside.config.ClubTimeZone;
import org.courtside.shared.OpeningWindow;
import org.springframework.stereotype.Component;

import java.time.DayOfWeek;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Component
public class OpeningHoursRule implements BookingRule {

    private final FacilityService facility;
    private final ClubTimeZone timeZone;

    public OpeningHoursRule(FacilityService facility, ClubTimeZone timeZone) {
        this.facility = facility;
        this.timeZone = timeZone;
    }

    @Override
    public boolean isOverridable() {
        return false;
    }

    @Override
    public List<RuleViolation> check(RuleContext context) {
        return check(context, facility.openingHoursFor(
                context.slot().start().atZone(timeZone.zoneId()).getDayOfWeek()));
    }

    @Override
    public Prepared prepare() {
        Map<DayOfWeek, Optional<OpeningHours>> hoursByDay = new HashMap<>();
        return context -> {
            DayOfWeek day = context.slot().start().atZone(timeZone.zoneId()).getDayOfWeek();
            return check(context, hoursByDay.computeIfAbsent(day, facility::openingHoursFor));
        };
    }

    private List<RuleViolation> check(RuleContext context, Optional<OpeningHours> hours) {
        ZoneId zone = timeZone.zoneId();
        ZonedDateTime start = context.slot().start().atZone(zone);
        ZonedDateTime end = context.slot().end().atZone(zone);

        if (hours.isEmpty()) {
            return List.of(new RuleViolation("booking.rule.openingHours.closed",
                    Map.of("day", start.getDayOfWeek().name())));
        }

        OpeningWindow window = new OpeningWindow(hours.get().getOpensAt(), hours.get().getClosesAt());
        if (!start.toLocalDate().equals(end.toLocalDate())
                || !window.covers(start.toLocalTime(), end.toLocalTime())) {
            return List.of(new RuleViolation("booking.rule.openingHours.outside",
                    Map.of("opensAt", window.opensAt().toString(),
                           "closesAt", window.closesAt().toString())));
        }
        return List.of();
    }
}
