package org.courtside.booking;

import org.courtside.identity.Role;
import org.courtside.shared.TimeSlot;

import java.util.List;
import java.util.Set;
import java.util.UUID;

public record BookingRuleCheck(
        List<UUID> courtIds,
        UUID cardId,
        TimeSlot slot,
        UUID bookedBy,
        UUID bookedByPersonId,
        Set<Role> callerRoles) {

    public BookingRuleCheck {
        courtIds = courtIds == null ? List.of() : List.copyOf(courtIds);
        callerRoles = callerRoles == null ? Set.of() : Set.copyOf(callerRoles);
        if (courtIds.isEmpty()) {
            throw new IllegalArgumentException("A rule check needs at least one court");
        }
    }

    static BookingRuleCheck of(CreateBookingCommand command) {
        return new BookingRuleCheck(command.courtIds(), command.cardId(), command.slot(),
                command.bookedBy(), command.bookedByPersonId(), command.callerRoles());
    }
}
