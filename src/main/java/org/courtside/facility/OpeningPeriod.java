package org.courtside.facility;

import org.courtside.shared.OpeningWindow;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.EnumMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Dates from {@code startsOn} to {@code endsOn}, both inclusive, whose hours replace the weekly
 * opening hours. A holiday replaces a season on the days both cover; a weekday without a window
 * is closed.
 */
public record OpeningPeriod(UUID id, Kind kind, String name, LocalDate startsOn, LocalDate endsOn,
                            Map<DayOfWeek, OpeningWindow> days) {

    public enum Kind { SEASON, HOLIDAY }

    public OpeningPeriod {
        Map<DayOfWeek, OpeningWindow> copy = new EnumMap<>(DayOfWeek.class);
        if (days != null) {
            days.forEach((day, window) -> {
                if (day != null && window != null) {
                    copy.put(day, window);
                }
            });
        }
        days = Map.copyOf(copy);
    }

    public boolean covers(LocalDate date) {
        return !date.isBefore(startsOn) && !date.isAfter(endsOn);
    }

    public Optional<OpeningWindow> windowOn(LocalDate date) {
        return Optional.ofNullable(days.get(date.getDayOfWeek()));
    }
}
