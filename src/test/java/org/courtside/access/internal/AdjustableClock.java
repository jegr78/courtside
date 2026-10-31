package org.courtside.access.internal;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicReference;

final class AdjustableClock extends Clock {

    private final AtomicReference<Instant> now;

    AdjustableClock(Instant start) {
        this.now = new AtomicReference<>(start);
    }

    void advance(Duration by) {
        now.updateAndGet(instant -> instant.plus(by));
    }

    void set(Instant to) {
        now.set(to);
    }

    @Override
    public Instant instant() {
        return now.get();
    }

    @Override
    public ZoneId getZone() {
        return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
        return this;
    }
}
