package org.courtside.audit;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface AuditLogExport {

    record ExportedChange(UUID id, Instant occurredAt, String eventType, UUID subjectId, String subjectName,
                          UUID actorAccountId, String actorUsername, String parameters) {
    }

    // Newest first, in the order the interactive log pages; `after` is the last id of the previous batch.
    List<ExportedChange> changes(Instant from, Instant before, UUID after, int size);
}
