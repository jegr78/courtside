package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.time.Instant;
import java.util.UUID;

@NullMarked
public record BookingExtended(UUID bookingId, UUID extendedByAccountId, Instant previousEndsAt, Instant endsAt)
        implements DomainEventRecord {

    static final String TYPE = "booking.extended";

    @Override
    public String eventType() {
        return TYPE;
    }

    @Override
    public UUID subjectId() {
        return bookingId;
    }
}
