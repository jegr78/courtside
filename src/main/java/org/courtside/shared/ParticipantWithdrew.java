package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.util.UUID;

@NullMarked
public record ParticipantWithdrew(UUID bookingId, UUID personId) implements DomainEventRecord {

    static final String TYPE = "booking.participant.withdrew";

    @Override
    public String eventType() {
        return TYPE;
    }

    @Override
    public UUID subjectId() {
        return bookingId;
    }
}
