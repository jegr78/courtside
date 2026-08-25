package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.util.UUID;

// The event names the booking and nothing else: what a message says about it is read when the
// message is written, so nothing that outlives this record describes where anybody plays.
@NullMarked
public record BookingConfirmed(UUID bookingId) implements DomainEventRecord {

    static final String TYPE = "booking.booking.confirmed";

    @Override
    public String eventType() {
        return TYPE;
    }

    @Override
    public UUID subjectId() {
        return bookingId;
    }
}
