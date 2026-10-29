package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.util.UUID;

@NullMarked
public record CardGrantsAccess(UUID cardId) implements DomainEventRecord {

    static final String TYPE = "card.bookingCard.accessGranted";

    @Override
    public String eventType() {
        return TYPE;
    }

    @Override
    public UUID subjectId() {
        return cardId;
    }
}
