package org.courtside.booking.waitlist;

import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.identity.Role;
import org.courtside.shared.TimeSlot;

import java.util.List;
import java.util.Set;
import java.util.UUID;

public record JoinWaitlistCommand(UUID courtId, UUID cardId, TimeSlot slot, UUID accountId, UUID personId,
                                  Set<Role> roles, String note, List<ParticipantSpec> participants) {

    public JoinWaitlistCommand {
        roles = roles == null ? Set.of() : Set.copyOf(roles);
        participants = participants == null ? List.of() : List.copyOf(participants);
    }

    CreateBookingCommand asBooking() {
        return new CreateBookingCommand(List.of(courtId), cardId, slot, accountId, personId, roles, note,
                participants, null);
    }
}
