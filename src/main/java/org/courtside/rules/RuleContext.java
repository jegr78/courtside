package org.courtside.rules;

import org.courtside.shared.TimeSlot;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/** {@code courtId} is the first of {@code courtIds}, the courts the booking holds together. */
public record RuleContext(
        UUID courtId,
        UUID cardId,
        TimeSlot slot,
        UUID userAccountId,
        UUID membershipTypeId,
        Set<UUID> movedBookingIds,
        List<UUID> courtIds) {

    public RuleContext {
        movedBookingIds = movedBookingIds == null ? Set.of() : Set.copyOf(movedBookingIds);
        courtIds = courtIds == null || courtIds.isEmpty()
                ? (courtId == null ? List.of() : List.of(courtId))
                : List.copyOf(courtIds);
    }

    public RuleContext(UUID courtId, UUID cardId, TimeSlot slot, UUID userAccountId, UUID membershipTypeId,
                       Set<UUID> movedBookingIds) {
        this(courtId, cardId, slot, userAccountId, membershipTypeId, movedBookingIds, List.of());
    }

    public RuleContext(UUID courtId, UUID cardId, TimeSlot slot, UUID userAccountId, UUID membershipTypeId) {
        this(courtId, cardId, slot, userAccountId, membershipTypeId, Set.of());
    }
}
