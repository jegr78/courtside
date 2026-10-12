package org.courtside.rules;

import java.time.LocalTime;

public record BookingWindow(LocalTime earliestStart, LocalTime latestEnd) {

    public BookingWindow {
        if (earliestStart == null || latestEnd == null) {
            throw new IllegalArgumentException("A booking window needs an earliest start and a latest end");
        }
        if (!latestEnd.isAfter(earliestStart)) {
            throw new IllegalArgumentException("A booking window ends after it starts");
        }
    }

    public static BookingWindow ofMinutesOfDay(int earliestStart, int latestEnd) {
        return new BookingWindow(LocalTime.ofSecondOfDay(earliestStart * 60L),
                LocalTime.ofSecondOfDay(latestEnd * 60L));
    }

    public boolean covers(LocalTime start, LocalTime end) {
        return !start.isBefore(earliestStart) && !end.isAfter(latestEnd);
    }
}
