package org.courtside.rules.internal;

import org.courtside.facility.Court;
import org.courtside.facility.CourtClosure;
import org.courtside.facility.FacilityService;
import org.courtside.facility.OpeningSchedule;
import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleViolation;
import org.courtside.config.ClubTimeZone;
import org.courtside.shared.OpeningWindow;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
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
        return check(context, facility.openingSchedule(), facility.courtClosures());
    }

    @Override
    public Prepared prepare() {
        OpeningSchedule schedule = facility.openingSchedule();
        List<CourtClosure> closures = facility.courtClosures();
        return context -> check(context, schedule, closures);
    }

    private List<RuleViolation> check(RuleContext context, OpeningSchedule schedule, List<CourtClosure> closures) {
        ZoneId zone = timeZone.zoneId();
        ZonedDateTime start = context.slot().start().atZone(zone);
        ZonedDateTime end = context.slot().end().atZone(zone);
        Optional<OpeningWindow> hours = schedule.windowOn(start.toLocalDate());

        if (hours.isEmpty()) {
            return List.of(new RuleViolation("booking.rule.openingHours.closed",
                    Map.of("day", start.getDayOfWeek().name())));
        }

        OpeningWindow window = hours.get();
        if (!start.toLocalDate().equals(end.toLocalDate())
                || !window.covers(start.toLocalTime(), end.toLocalTime())) {
            return List.of(new RuleViolation("booking.rule.openingHours.outside",
                    Map.of("opensAt", window.opensAt().toString(),
                           "closesAt", window.closesAt().toString())));
        }
        return closedCourt(context, start.toLocalDate(), closures).stream().toList();
    }

    private Optional<RuleViolation> closedCourt(RuleContext context, LocalDate date, List<CourtClosure> closures) {
        return context.courtIds().stream()
                .flatMap(courtId -> closures.stream()
                        .filter(closure -> closure.courtId().equals(courtId) && closure.covers(date)))
                .findFirst()
                .map(closure -> new RuleViolation("booking.rule.openingHours.courtClosed",
                        Map.of("court", facility.findCourt(closure.courtId()).map(Court::getNumber).orElse(0),
                               "endsOn", closure.endsOn().toString())));
    }
}
