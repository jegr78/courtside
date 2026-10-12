package org.courtside.shared;

import org.jspecify.annotations.NullMarked;
import org.jspecify.annotations.Nullable;

import java.util.UUID;

@NullMarked
public record BookingCancelled(UUID bookingId, UUID cancelledByAccountId, @Nullable CancellationReason reason)
        implements DomainEventRecord {

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
