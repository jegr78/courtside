package org.courtside.booking.series;

import org.courtside.shared.TimeSlot;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.List;

@Component
public class SeriesSchedule {

    private final ZoneId zone;
    private final int horizonMonths;

    public SeriesSchedule(@Value("${courtside.booking.time-zone}") String zone,
                          @Value("${courtside.booking.series-horizon-months}") int horizonMonths) {
        this.zone = ZoneId.of(zone);
        this.horizonMonths = horizonMonths;
    }

    public Expansion expand(SeriesRule rule) {
        LocalDate horizon = rule.startsOn().plusMonths(horizonMonths);
        LocalDate last = rule.endsOn() == null ? horizon : min(rule.endsOn(), horizon);
        int wanted = rule.occurrenceCount() == null ? Integer.MAX_VALUE : rule.occurrenceCount();

        List<TimeSlot> slots = new ArrayList<>();
        LocalDate weekStart = rule.startsOn().with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));

        while (slots.size() < wanted && !weekStart.isAfter(last)) {
            for (int offset = 0; offset < 7; offset++) {
                LocalDate day = weekStart.plusDays(offset);
                if (day.isBefore(rule.startsOn()) || day.isAfter(last) || slots.size() >= wanted) {
                    continue;
                }
                if (rule.weekdays().contains(day.getDayOfWeek())) {
                    slots.add(slotOn(day, rule));
                }
            }
            weekStart = weekStart.plusWeeks(rule.intervalWeeks());
        }

        boolean truncatedByHorizon = rule.endsOn() == null
                ? slots.size() < wanted
                : rule.endsOn().isAfter(horizon);
        return new Expansion(slots, truncatedByHorizon, horizon);
    }

    public record Expansion(List<TimeSlot> slots, boolean truncatedByHorizon, LocalDate horizonLimit) {

        public Expansion {
            slots = List.copyOf(slots);
        }
    }

    // The local wall-clock time is what a club agrees on, so each occurrence is resolved in the
    // club's zone rather than by adding seven days to the previous instant across a DST change.
    private TimeSlot slotOn(LocalDate day, SeriesRule rule) {
        var start = day.atTime(rule.startTime()).atZone(zone);
        return new TimeSlot(start.toInstant(),
                start.plusMinutes(rule.durationMinutes()).toInstant());
    }

    private static LocalDate min(LocalDate a, LocalDate b) {
        return a.isBefore(b) ? a : b;
    }
}
