package org.courtside.access;

import org.jspecify.annotations.NullMarked;
import org.jspecify.annotations.Nullable;

import java.time.Instant;

/** How the system answered a call; a reason is the connector's own text and never carries a code or a person. */
@NullMarked
public sealed interface GrantOutcome {

    record Accepted(String externalReference) implements GrantOutcome {

        public Accepted {
            if (externalReference == null || externalReference.isBlank() || externalReference.length() > 200) {
                throw new IllegalArgumentException("An external reference has 1 to 200 characters");
            }
        }
    }

    /** The code is not on the remote user now. */
    record CodeRejected() implements GrantOutcome {
    }

    /** A null {@code notBefore} leaves the retry to the caller's backoff. */
    record RetryLater(Scope scope, @Nullable Instant notBefore, String reason) implements GrantOutcome {

        public RetryLater {
            if (scope == null || reason == null) {
                throw new IllegalArgumentException("A retry names its scope and its reason");
            }
        }
    }

    record Refused(Scope scope, String reason) implements GrantOutcome {

        public Refused {
            if (scope == null || reason == null) {
                throw new IllegalArgumentException("A refusal names its scope and its reason");
            }
        }
    }
}
