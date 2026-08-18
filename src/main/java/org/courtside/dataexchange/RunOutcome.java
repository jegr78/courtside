package org.courtside.dataexchange;

import java.time.Instant;
import java.util.UUID;

public record RunOutcome(UUID runId, UUID sourceId, UUID previewId, SnapshotMode mode,
                         String fileHash, int created, int corrected, int membershipsEnded,
                         int accountsDisabled, int rolesRemoved, int rowErrors,
                         boolean removalsConfirmed, Instant executedAt) {
}
