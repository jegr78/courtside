package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.util.UUID;

// Who was recorded and where, by identifier: the message that follows resolves the rest, so the
// record does not carry a name and does not say who did the recording.
@NullMarked
public record ParticipantRecorded(UUID bookingId, UUID personId) implements DomainEventRecord {

    static final String TYPE = "booking.participant.recorded";

    @Override
    public String eventType() {
        return TYPE;
    }

    @Override
    public UUID subjectId() {
        return bookingId;
    }
}
