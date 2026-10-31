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

    record Reading(ProbeClassification classification, String detail, Instant checkedAt) {

        boolean reachable() {
            return classification == ProbeClassification.ANSWERED;
        }
    }

    private final AtomicReference<Reading> latest = new AtomicReference<>();
    private final AtomicReference<Instant> answeredAt = new AtomicReference<>();
    private final AtomicBoolean requested = new AtomicBoolean();

    void record(ProbeOutcome answer, Instant checkedAt) {
        switch (answer) {
            case ProbeOutcome.Answered answered -> {
                answeredAt.set(checkedAt);
                record(ProbeClassification.ANSWERED, "", checkedAt);
            }
            case ProbeOutcome.Unreachable(String reason) -> record(ProbeClassification.UNREACHABLE, reason, checkedAt);
            case ProbeOutcome.Refused(String reason) -> record(ProbeClassification.REFUSED, reason, checkedAt);
        }
    }

    void record(ProbeClassification classification, Instant checkedAt) {
        record(classification, "", checkedAt);
    }

    private void record(ProbeClassification classification, String reason, Instant checkedAt) {
        String detail = ConnectorText.sanitized(reason, null);
        latest.set(new Reading(classification,
                detail.length() > MOST_DETAIL_CHARACTERS ? detail.substring(0, MOST_DETAIL_CHARACTERS) : detail,
                checkedAt));
    }

    Optional<Instant> answeredAt() {
        return Optional.ofNullable(answeredAt.get());
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
