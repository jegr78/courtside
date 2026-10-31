package org.courtside.access.internal;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;

/** Loxone's time base: seconds since 2009-01-01 00:00 of the Miniserver's wall clock, read in the club's zone. */
final class LoxoneTime {

    private static final LocalDateTime EPOCH = LocalDateTime.of(2009, 1, 1, 0, 0);

    private LoxoneTime() {
    }

    static long from(Instant instant, ZoneId zone) {
        return sinceEpoch(instant, zone).getSeconds();
    }

    static long until(Instant instant, ZoneId zone) {
        Duration since = sinceEpoch(instant, zone);
        return since.getSeconds() + (since.getNano() > 0 ? 1 : 0);
    }

    static Instant instant(long seconds, ZoneId zone) {
        return EPOCH.plusSeconds(seconds).atZone(zone).toInstant();
    }

    private static Duration sinceEpoch(Instant instant, ZoneId zone) {
        return Duration.between(EPOCH, LocalDateTime.ofInstant(instant, zone));
    }
}
