package org.courtside.access;

import org.jspecify.annotations.NullMarked;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

@NullMarked
public record GrantInstruction(GrantReference reference, String code, Instant validFrom, Instant validUntil,
                               Set<UUID> accessPointIds) {

    public GrantInstruction {
        if (reference == null || code == null || validFrom == null || validUntil == null || accessPointIds == null) {
            throw new IllegalArgumentException("A grant instruction names its grant, code, window and access points");
        }
        if (!code.matches("[0-9]{4,8}")) {
            throw new IllegalArgumentException("An access code has 4 to 8 digits");
        }
        if (!validUntil.isAfter(validFrom)) {
            throw new IllegalArgumentException("A validity window ends after it starts");
        }
        if (accessPointIds.isEmpty()) {
            throw new IllegalArgumentException("A grant opens at least one access point");
        }
        accessPointIds = Set.copyOf(accessPointIds);
    }

    @Override
    public String toString() {
        return "GrantInstruction[reference=" + reference + ", validFrom=" + validFrom + ", validUntil="
                + validUntil + ", accessPointIds=" + accessPointIds + "]";
    }
}
