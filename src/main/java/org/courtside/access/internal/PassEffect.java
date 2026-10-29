package org.courtside.access.internal;

import java.time.Instant;

/** What a recorded answer means for the rest of the pass. */
sealed interface PassEffect {

    record Continue() implements PassEffect {
    }

    record Outage() implements PassEffect {
    }

    record Hold(Instant until) implements PassEffect {
    }
}
