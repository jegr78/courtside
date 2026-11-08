package org.courtside.booking;

import org.courtside.shared.DomainEventRecord;
import org.jspecify.annotations.NullMarked;

import java.util.UUID;

@NullMarked
public record BookingPaymentExpired(UUID bookingId, UUID bookedByAccountId) implements DomainEventRecord {

    static final String TYPE = "booking.payment.expired";

    @Override
    public String eventType() {
        return TYPE;
    }

    @Override
    public UUID subjectId() {
        return bookingId;
    }
}
