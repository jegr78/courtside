package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.util.UUID;

@NullMarked
public record BookingAccessCodeChanged(UUID bookingId) implements DomainEventRecord {

    static final String TYPE = "booking.booking.accessCodeChanged";

    @Override
    public String eventType() {
        return TYPE;
    }

    @Override
    public UUID subjectId() {
        return bookingId;
    }
}
