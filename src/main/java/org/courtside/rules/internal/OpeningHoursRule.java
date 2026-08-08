package org.courtside.rules.internal;

import org.courtside.facility.FacilityService;
import org.courtside.facility.OpeningHours;
import org.courtside.rules.RuleContext;
import org.courtside.rules.RuleViolation;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Component
public class OpeningHoursRule implements BookingRule {

    private final FacilityService facility;
    private final ZoneId zone;

    public OpeningHoursRule(FacilityService facility,
                            @Value("${courtside.booking.time-zone}") String zone) {
        this.facility = facility;
        this.zone = ZoneId.of(zone);
    }

    @Override
    public boolean isOverridable() {
        return false;
    }

    @Override
    public List<RuleViolation> check(RuleContext context) {
        ZonedDateTime start = context.slot().start().atZone(zone);
        ZonedDateTime end = context.slot().end().atZone(zone);

        Optional<OpeningHours> hours = facility.openingHoursFor(start.getDayOfWeek());
        if (hours.isEmpty()) {
            return List.of(new RuleViolation("booking.rule.openingHours.closed",
                    Map.of("day", start.getDayOfWeek().name())));
        }

        LocalTime opensAt = hours.get().getOpensAt();
        LocalTime closesAt = hours.get().getClosesAt();
        if (start.toLocalTime().isBefore(opensAt) || end.toLocalTime().isAfter(closesAt)) {
            return List.of(new RuleViolation("booking.rule.openingHours.outside",
                    Map.of("opensAt", opensAt.toString(), "closesAt", closesAt.toString())));
        }
        return List.of();
    }
}
