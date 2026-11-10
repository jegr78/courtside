package org.courtside;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.concurrent.atomic.AtomicReference;

public final class TestClock extends Clock {

    private final Instant initial;
    private final AtomicReference<Instant> now;
    private final ZoneId zone;

    TestClock(Instant initial, ZoneId zone) {
        this(initial, new AtomicReference<>(initial), zone);
    }

    private TestClock(Instant initial, AtomicReference<Instant> now, ZoneId zone) {
        this.initial = initial;
        this.now = now;
        this.zone = zone;
    }

    public void set(Instant instant) {
        now.set(instant);
    }

    public void reset() {
        now.set(initial);
    }

    @Override
    public Instant instant() {
        return now.get();
    }

    @Override
    public ZoneId getZone() {
        return zone;
    }

    @Override
    public Clock withZone(ZoneId other) {
        return new TestClock(initial, now, other);
    }
}
