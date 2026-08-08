package org.courtside.booking.series;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public record SeriesRule(
        List<UUID> courtIds,
        UUID cardId,
        LocalDate startsOn,
        LocalTime startTime,
        int durationMinutes,
        int intervalWeeks,
        Set<DayOfWeek> weekdays,
        LocalDate endsOn,
        Integer occurrenceCount) {

    public static final int MAX_OCCURRENCES = 200;
    public static final int MAX_DURATION_MINUTES = 1440;
    public static final int MAX_INTERVAL_WEEKS = 52;

    public SeriesRule {
        if ((endsOn == null) == (occurrenceCount == null)) {
            throw new IllegalArgumentException(
                    "A series ends either on a date or after a number of occurrences");
        }
        if (occurrenceCount != null && occurrenceCount <= 0) {
            throw new IllegalArgumentException("occurrenceCount must be positive");
        }
        if (occurrenceCount != null && occurrenceCount > MAX_OCCURRENCES) {
            throw new IllegalArgumentException(
                    "occurrenceCount must not exceed " + MAX_OCCURRENCES);
        }
        if (endsOn != null && endsOn.isBefore(startsOn)) {
            throw new IllegalArgumentException("A series cannot end before it starts");
        }
        if (weekdays == null || weekdays.isEmpty()) {
            throw new IllegalArgumentException("A series needs at least one weekday");
        }
        if (courtIds == null || courtIds.isEmpty()) {
            throw new IllegalArgumentException("A series needs at least one court");
        }
        if (intervalWeeks < 1 || intervalWeeks > MAX_INTERVAL_WEEKS) {
            throw new IllegalArgumentException(
                    "The interval must be between one and %d weeks".formatted(MAX_INTERVAL_WEEKS));
        }
        if (durationMinutes < 1 || durationMinutes > MAX_DURATION_MINUTES) {
            throw new IllegalArgumentException(
                    "The duration must be between one and %d minutes".formatted(MAX_DURATION_MINUTES));
        }
        courtIds = List.copyOf(courtIds);
        weekdays = Set.copyOf(weekdays);
    }
}
