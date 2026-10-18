package org.courtside.booking;

import org.courtside.identity.Role;
import org.courtside.shared.TimeSlot;

import java.util.List;
import java.util.Set;
import java.util.UUID;

public record CreateBookingCommand(
        List<UUID> courtIds,
        UUID cardId,
        TimeSlot slot,
        UUID bookedBy,
        UUID bookedByPersonId,
        Set<Role> callerRoles,
        String note,
        List<ParticipantSpec> participants,
        UUID seriesId,
        UUID actedBy) {

    public CreateBookingCommand(List<UUID> courtIds, UUID cardId, TimeSlot slot, UUID bookedBy, UUID bookedByPersonId,
                                Set<Role> callerRoles, String note, List<ParticipantSpec> participants, UUID seriesId) {
        this(courtIds, cardId, slot, bookedBy, bookedByPersonId, callerRoles, note, participants, seriesId, null);
    }

    public CreateBookingCommand {
        callerRoles = callerRoles == null ? Set.of() : Set.copyOf(callerRoles);
        participants = participants == null ? List.of() : List.copyOf(participants);
        courtIds = courtIds == null ? List.of() : List.copyOf(courtIds);
    }
}
