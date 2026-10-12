package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.util.UUID;

@NullMarked
public record WaitlistOffered(UUID entryId, UUID accountId) implements DomainEventRecord {

    static final String TYPE = "booking.waitlist.offered";

    @Override
    public String eventType() {
        return TYPE;
    }

    @Override
    public UUID subjectId() {
        return entryId;
    }
}
