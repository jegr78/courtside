package org.courtside.access.internal;

import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/** The latest connection check, kept in memory, and a board's request for a fresh one. */
@Component
class ConnectionCheckReadings {

    record Report(Instant checkedAt, List<ConnectionCheckRun.Checked> checks) {
    }

    private final AtomicReference<Report> latest = new AtomicReference<>();
    private final AtomicBoolean requested = new AtomicBoolean();

    void record(Instant checkedAt, List<ConnectionCheckRun.Checked> checks) {
        latest.set(new Report(checkedAt, List.copyOf(checks)));
    }

    Optional<Report> latest() {
        return Optional.ofNullable(latest.get());
    }

    void request() {
        requested.set(true);
    }

    boolean takeRequest() {
        return requested.getAndSet(false);
    }
}
