package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.util.UUID;

@NullMarked
public record BookingCancelled(UUID bookingId, UUID cancelledByAccountId) implements DomainEventRecord {

    static final String TYPE = "booking.booking.cancelled";

    @Override
    public String eventType() {
        return TYPE;
    }

    @Override
    public UUID subjectId() {
        return bookingId;
    }
}
