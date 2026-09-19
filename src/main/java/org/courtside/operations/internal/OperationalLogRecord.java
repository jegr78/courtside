package org.courtside.operations.internal;

import java.time.Instant;
import java.util.UUID;

record OperationalLogRecord(
        UUID id,
        Instant occurredAt,
        OperationalLogSource source,
        OperationalLogSeverity severity,
        String message,
        String traceId) {
}
