package org.courtside.access.internal;

import org.courtside.access.GrantOutcome;

sealed interface CallResult {

    record Answered(GrantOutcome outcome) implements CallResult {
    }

    /** An exception or a missed deadline: the call may have been applied. */
    record Unclear() implements CallResult {
    }
}
