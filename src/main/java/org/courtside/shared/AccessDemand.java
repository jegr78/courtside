package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.time.Instant;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/** What a confirmed booking whose card grants access asks of an access-control system. */
@NullMarked
public record AccessDemand(UUID bookingId, Instant startsAt, Instant validFrom, Instant validUntil,
                           Set<UUID> accessPointIds) {

    public AccessDemand {
        if (bookingId == null || startsAt == null || validFrom == null || validUntil == null
                || accessPointIds == null) {
            throw new IllegalArgumentException("An access demand names its booking, window and access points");
        }
        if (!validUntil.isAfter(validFrom)) {
            throw new IllegalArgumentException("A validity window ends after it starts");
        }
        if (accessPointIds.isEmpty() || accessPointIds.stream().anyMatch(Objects::isNull)) {
            throw new IllegalArgumentException("An access demand names at least one access point");
        }
        accessPointIds = Set.copyOf(accessPointIds);
    }
}
