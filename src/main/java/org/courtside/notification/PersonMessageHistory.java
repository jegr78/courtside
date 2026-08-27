package org.courtside.notification;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface PersonMessageHistory {

    // What became of a message, never what it said: the record itself holds no body and no
    // address, and an answer about a person must not invent one.
    record Message(Instant queuedAt, Instant settledAt, MessageKind kind, MessageState state,
                   String reason, String statusCode, String messageId) {
    }

    record Declined(MessageKind kind, Instant declinedAt) {
    }

    List<Message> sentTo(UUID accountId);

    List<Declined> declinedBy(UUID accountId);
}
