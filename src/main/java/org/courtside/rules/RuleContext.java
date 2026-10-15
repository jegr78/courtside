package org.courtside.rules;

import org.courtside.shared.TimeSlot;

import java.util.Set;
import java.util.UUID;

public record RuleContext(
        UUID courtId,
        UUID cardId,
        TimeSlot slot,
        UUID userAccountId,
        UUID membershipTypeId,
        Set<UUID> movedBookingIds) {

    public RuleContext {
        movedBookingIds = movedBookingIds == null ? Set.of() : Set.copyOf(movedBookingIds);
    }

    public RuleContext(UUID courtId, UUID cardId, TimeSlot slot, UUID userAccountId, UUID membershipTypeId) {
        this(courtId, cardId, slot, userAccountId, membershipTypeId, Set.of());
    }
}
