package org.courtside.dataexchange;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record PreviewSummary(UUID previewId, UUID sourceId, SnapshotMode mode, String fileName,
                             String fileHash, int rowCount, List<String> ignoredColumns,
                             ResolvedChangeSet changeSet, boolean needsConfirmation,
                             Instant createdAt, Instant expiresAt, boolean superseded) {

    public PreviewSummary {
        ignoredColumns = List.copyOf(ignoredColumns);
    }
}
