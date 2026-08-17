package org.courtside.shared;

import org.courtside.api.ApiDayOfWeek;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

// UTC and not the club's zone.
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
