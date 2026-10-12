package org.courtside.booking.internal;

import org.courtside.shared.TimeSlot;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

// Every caller holds the booking grid lock, which is what keeps a reservation and a booking apart.
public interface CourtReservations {

    void requireUnreserved(List<UUID> courtIds, TimeSlot slot, UUID accountId);

    List<Reserved> reservedBetween(Instant from, Instant to);

    void booked(UUID accountId, UUID bookingId, List<UUID> courtIds, TimeSlot slot);

    void released(List<UUID> courtIds, TimeSlot slot);

    record Reserved(UUID courtId, TimeSlot slot, UUID accountId) {

        public boolean blocks(List<UUID> courtIds, TimeSlot wanted, UUID bookedBy) {
            return courtIds.contains(courtId) && slot.overlaps(wanted) && !accountId.equals(bookedBy);
        }
    }
}
