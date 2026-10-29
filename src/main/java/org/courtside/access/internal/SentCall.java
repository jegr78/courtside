package org.courtside.access.internal;

import org.courtside.access.GrantInstruction;
import org.courtside.access.GrantReference;
import org.jspecify.annotations.Nullable;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

/** The receipt of a pre-call commit: what is sent, and what an undone attempt restores. */
record SentCall(Action action, UUID grantId, Instant sentAt, @Nullable Instant validFrom,
                @Nullable Instant validUntil, Set<UUID> accessPointIds, @Nullable String mapping,
                @Nullable String code, @Nullable String externalReference,
                @Nullable Instant previousNextAttemptAt) {

    GrantReference reference() {
        return new GrantReference(grantId, externalReference);
    }

    GrantInstruction instruction() {
        if (!action.installs() || code == null || validFrom == null || validUntil == null) {
            throw new IllegalStateException("Only an install carries an instruction");
        }
        return new GrantInstruction(reference(), code, validFrom, validUntil, accessPointIds);
    }

    @Override
    public String toString() {
        return "SentCall[action=" + action + ", grantId=" + grantId + ", sentAt=" + sentAt + ", validFrom="
                + validFrom + ", validUntil=" + validUntil + ", accessPointIds=" + accessPointIds + "]";
    }
}
