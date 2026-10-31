package org.courtside.access.internal;

import java.time.Instant;
import java.time.ZoneId;

final class LoxoneTime {

    private LoxoneTime() {
    }

    static long from(Instant instant, ZoneId zone) {
        return 0;
    }

    static long until(Instant instant, ZoneId zone) {
        return 0;
    }

    static Instant instant(long seconds, ZoneId zone) {
        return Instant.EPOCH;
    }
}
