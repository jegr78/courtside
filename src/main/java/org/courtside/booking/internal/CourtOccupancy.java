package org.courtside.booking.internal;

import org.courtside.shared.TimeSlot;

import java.time.Instant;
import java.util.UUID;

public record CourtOccupancy(UUID courtId, Instant startsAt, Instant endsAt) {

    public boolean overlaps(TimeSlot slot) {
        return startsAt.isBefore(slot.end()) && endsAt.isAfter(slot.start());
    }
}
