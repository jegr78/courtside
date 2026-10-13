package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.util.UUID;

// The member who took a published place, by identifier; the messages that follow resolve the rest.
@NullMarked
public record PartnerJoined(UUID bookingId, UUID personId) implements DomainEventRecord {

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
