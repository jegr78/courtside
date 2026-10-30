package org.courtside.access.internal;

import java.time.Duration;

/** How a pass ended, which tells the worker how long to wait before the next one. */
sealed interface PassResult {

    /** Another instance holds the pass lock. */
    record Skipped() implements PassResult {
    }

    record Completed() implements PassResult {
    }

    /** The probe failed or the call thread was busy, so the rest of the rows wait for the next pass. */
    record Outage() implements PassResult {
    }

    /** The system asked for a pause; no pass starts before it ends, whatever signals arrive. */
    record Held(Duration duration) implements PassResult {
    }

    /** The pass lock's session was lost, so the pass stopped before its next remote call. */
    record LockLost() implements PassResult {
    }
}
