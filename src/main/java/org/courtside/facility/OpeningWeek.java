package org.courtside.facility;

import org.courtside.shared.OpeningWindow;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.EnumMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * One version of the weekly opening hours. A weekday without a window is closed, and a week
 * without {@code effectiveFrom} has been in force since the beginning.
 */
public record OpeningWeek(UUID id, LocalDate effectiveFrom, Map<DayOfWeek, OpeningWindow> days) {

    public OpeningWeek {
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

    public Optional<OpeningWindow> windowOn(DayOfWeek day) {
        return Optional.ofNullable(days.get(day));
    }

    boolean startsOnOrBefore(LocalDate date) {
        return effectiveFrom == null || !effectiveFrom.isAfter(date);
    }
}
