package org.courtside.booking.web;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.Map;

/** The days a court plan read covers: one day, or a range of at most a week, both bounds inclusive. */
record DayRange(LocalDate first, LocalDate last) {

    static final long MAX_DAYS = 7;

    static DayRange of(LocalDate date, LocalDate from, LocalDate to) {
        if (date != null && (from != null || to != null)) {
            throw new DayRangeInvalidException("booking.dayRange.dayAndRange", Map.of());
        }
        if (date != null) {
            return new DayRange(date, date);
        }
        if (from == null || to == null) {
            throw new DayRangeInvalidException("booking.dayRange.incomplete", Map.of());
        }
        if (to.isBefore(from)) {
            throw new DayRangeInvalidException("booking.dayRange.reversed", Map.of());
        }
        if (ChronoUnit.DAYS.between(from, to) + 1 > MAX_DAYS) {
            throw new DayRangeInvalidException("booking.dayRange.tooLong", Map.of("maxDays", MAX_DAYS));
        }
        return new DayRange(from, to);
    }

    Instant start(ZoneId zone) {
        return first.atStartOfDay(zone).toInstant();
    }

    Instant end(ZoneId zone) {
        return last.plusDays(1).atStartOfDay(zone).toInstant();
    }
}
