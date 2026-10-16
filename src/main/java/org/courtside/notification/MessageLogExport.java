package org.courtside.notification;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface MessageLogExport {

    record ExportedMessage(UUID id, Instant queuedAt, Instant settledAt, MessageKind kind, MessageState state,
                           String messageId, UUID personId, String personName, String reason,
                           String statusCode) {
    }

    // Newest first, in the order the interactive log pages; `after` is the last id of the previous batch.
    List<ExportedMessage> messages(Instant from, Instant before, UUID after, int size);
}
