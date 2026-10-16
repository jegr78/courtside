package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.util.UUID;

/** A started booking nobody checked in for was cancelled and its courts freed. */
@NullMarked
public record BookingReleased(UUID bookingId) implements DomainEventRecord {

    static final String TYPE = "booking.attendance.released";

    @Override
    public String eventType() {
        return TYPE;
    }

    @Override
    public UUID subjectId() {
        return bookingId;
    }
}
