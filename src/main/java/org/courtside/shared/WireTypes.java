package org.courtside.shared;

import org.courtside.api.ApiDayOfWeek;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

// The API document describes a moment as an RFC 3339 date-time, which the generator reads as an
// OffsetDateTime; the domain speaks Instant, because a booking happens at one moment regardless of
// how anyone writes it down. Every controller crossing that line crosses it here, so the choice of
// offset is made once and is the same in every response.
//
// UTC, and not the club's own zone: the offset a response carries says nothing the instant does not
// already say, and a club that moves across a daylight-saving boundary would otherwise change how
// its past bookings read.
public final class WireTypes {

    private WireTypes() {
    }

    public static OffsetDateTime toOffsetDateTime(Instant moment) {
        return moment == null ? null : moment.atOffset(ZoneOffset.UTC);
    }

    public static Instant toInstant(OffsetDateTime moment) {
        return moment == null ? null : moment.toInstant();
    }

    public static DayOfWeek toDayOfWeek(ApiDayOfWeek day) {
        return day == null ? null : DayOfWeek.valueOf(day.getValue());
    }

    public static ApiDayOfWeek toApiDayOfWeek(DayOfWeek day) {
        return day == null ? null : ApiDayOfWeek.fromValue(day.name());
    }
}
