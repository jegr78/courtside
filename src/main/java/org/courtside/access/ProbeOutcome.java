package org.courtside.access;

import org.jspecify.annotations.NullMarked;

/** Whether the system is reachable, accepts the credentials and grants the right to manage users. */
@NullMarked
public sealed interface ProbeOutcome {

    record Answered() implements ProbeOutcome {
    }

    record Unreachable(String reason) implements ProbeOutcome {
    }

    record Refused(String reason) implements ProbeOutcome {
    }
}
