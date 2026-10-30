package org.courtside.access.internal;

import java.time.Instant;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/** What a booking asks of the access-control system right now: its validity window and dynamic access points. */
record Demand(Instant validFrom, Instant validUntil, Set<UUID> accessPointIds) {

    Demand {
        if (validFrom == null || validUntil == null || accessPointIds == null) {
            throw new IllegalArgumentException("A demand names its window and its access points");
        }
        if (!validUntil.isAfter(validFrom)) {
            throw new IllegalArgumentException("A demand's window ends after it starts");
        }
        if (accessPointIds.isEmpty() || accessPointIds.stream().anyMatch(Objects::isNull)) {
            throw new IllegalArgumentException("A demand opens at least one access point");
        }
        accessPointIds = Set.copyOf(accessPointIds);
    }
}
