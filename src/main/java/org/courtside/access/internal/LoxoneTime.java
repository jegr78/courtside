package org.courtside.access.internal;

import java.time.Duration;
import java.time.Instant;

/** Loxone's time base: seconds since 2009-01-01T00:00:00Z, which a Miniserver shows in its own local time. */
final class LoxoneTime {

    private static final Instant EPOCH = Instant.parse("2009-01-01T00:00:00Z");

    private LoxoneTime() {
    }

    static long from(Instant instant) {
        return Duration.between(EPOCH, instant).getSeconds();
    }

    static long until(Instant instant) {
        Duration since = Duration.between(EPOCH, instant);
        return since.getSeconds() + (since.getNano() > 0 ? 1 : 0);
    }

    static Instant instant(long seconds) {
        return EPOCH.plusSeconds(seconds);
    }
}
