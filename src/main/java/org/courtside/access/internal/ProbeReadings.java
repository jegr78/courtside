package org.courtside.access.internal;

import org.courtside.access.ProbeOutcome;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/** The latest probe the pass made, kept in memory, and a board's request for a fresh one. */
@Component
class ProbeReadings {

    private static final int MOST_DETAIL_CHARACTERS = 500;

    record Reading(boolean reachable, String detail, Instant checkedAt) {
    }

    private final AtomicReference<Reading> latest = new AtomicReference<>();
    private final AtomicBoolean requested = new AtomicBoolean();

    void record(ProbeOutcome outcome, Instant checkedAt) {
        String detail = switch (outcome) {
            case ProbeOutcome.Answered answered -> "";
            case ProbeOutcome.Unreachable(String reason) -> reason;
            case ProbeOutcome.Refused(String reason) -> reason;
        };
        latest.set(new Reading(outcome instanceof ProbeOutcome.Answered,
                detail.length() > MOST_DETAIL_CHARACTERS ? detail.substring(0, MOST_DETAIL_CHARACTERS) : detail,
                checkedAt));
    }

    Optional<Reading> latest() {
        return Optional.ofNullable(latest.get());
    }

    void request() {
        requested.set(true);
    }

    boolean takeRequest() {
        return requested.getAndSet(false);
    }
}
