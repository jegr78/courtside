package org.courtside.booking.internal;

import org.courtside.shared.TimeSlot;

import java.util.List;
import java.util.UUID;

// Every caller holds the booking grid lock, which is what keeps a reservation and a booking apart.
public interface CourtReservations {

    void requireUnreserved(List<UUID> courtIds, TimeSlot slot, UUID accountId);

    List<UUID> reservedCourts(List<UUID> courtIds, TimeSlot slot, UUID accountId);

    void booked(UUID accountId, UUID bookingId, List<UUID> courtIds, TimeSlot slot);

    void released(List<UUID> courtIds, TimeSlot slot);
}
