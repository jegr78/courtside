package org.courtside.booking.internal;

import org.courtside.card.BookingCard;
import org.courtside.identity.Role;
import org.courtside.shared.TimeSlot;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.UUID;

// Every caller holds the booking grid lock, which is what keeps a reservation and a booking apart.
public interface CourtReservations {

    // The board and a closure go before a waiting member.
    static boolean overriddenBy(Set<Role> callerRoles, UUID cardId) {
        return callerRoles.contains(Role.ADMIN) || BookingCard.COURT_CLOSED.equals(cardId);
    }

    void requireUnreserved(List<UUID> courtIds, TimeSlot slot, UUID accountId);

    void withdrawFor(List<UUID> courtIds, TimeSlot slot, UUID accountId);

    void withdraw(Collection<UUID> entryIds);

    List<Reserved> reservedBetween(Instant from, Instant to);

    void booked(UUID accountId, UUID bookingId, List<UUID> courtIds, TimeSlot slot);

    void bookedAll(UUID accountId, List<Placement> placements);

    void released(List<UUID> courtIds, TimeSlot slot);

    record Placement(UUID bookingId, List<UUID> courtIds, TimeSlot slot) {
    }

    record Reserved(UUID entryId, UUID courtId, TimeSlot slot, UUID accountId) {

        public boolean blocks(List<UUID> courtIds, TimeSlot wanted, UUID bookedBy) {
            return courtIds.contains(courtId) && slot.overlaps(wanted) && !accountId.equals(bookedBy);
        }
    }
}
