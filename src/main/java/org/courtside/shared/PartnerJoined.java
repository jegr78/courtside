package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.util.UUID;

// The member who took a published place and the account they took it with, by identifier.
@NullMarked
public record PartnerJoined(UUID bookingId, UUID personId, UUID accountId) implements DomainEventRecord {

    static final String TYPE = "booking.partner.joined";

    @Override
    public String eventType() {
        return TYPE;
    }

    @Override
    public UUID subjectId() {
        return bookingId;
    }
}
