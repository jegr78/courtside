package org.courtside.dataexchange.internal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.courtside.dataexchange.SnapshotMode;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "import_run")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ImportRun {

    @Id
    private UUID id;

    @Column(name = "source_id", nullable = false)
    private UUID sourceId;

    @Column(name = "preview_id", nullable = false)
    private UUID previewId;

    @Enumerated(EnumType.STRING)
    @Column(name = "mode", nullable = false)
    private SnapshotMode mode;

    @Column(name = "file_hash", nullable = false)
    private String fileHash;

    @Column(name = "created_count", nullable = false)
    private int createdCount;

    @Column(name = "corrected_count", nullable = false)
    private int correctedCount;

    @Column(name = "ended_count", nullable = false)
    private int endedCount;

    @Column(name = "accounts_created_count", nullable = false)
    private int accountsCreatedCount;

    @Column(name = "accounts_disabled_count", nullable = false)
    private int accountsDisabledCount;

    @Column(name = "roles_removed_count", nullable = false)
    private int rolesRemovedCount;

    @Column(name = "row_error_count", nullable = false)
    private int rowErrorCount;

    @Column(name = "removals_confirmed", nullable = false)
    private boolean removalsConfirmed;

    @Column(name = "executed_at", nullable = false)
    private Instant executedAt;

    @Column(name = "executed_by_account_id", nullable = false)
    private UUID executedByAccountId;

    public ImportRun(UUID sourceId, UUID previewId, SnapshotMode mode, String fileHash,
                     int createdCount, int correctedCount, int endedCount, int accountsCreatedCount,
                     int accountsDisabledCount, int rolesRemovedCount, int rowErrorCount,
                     boolean removalsConfirmed, Instant executedAt, UUID executedByAccountId) {
        this.id = UUID.randomUUID();
        this.sourceId = sourceId;
        this.previewId = previewId;
        this.mode = mode;
        this.fileHash = fileHash;
        this.createdCount = createdCount;
        this.correctedCount = correctedCount;
        this.endedCount = endedCount;
        this.accountsCreatedCount = accountsCreatedCount;
        this.accountsDisabledCount = accountsDisabledCount;
        this.rolesRemovedCount = rolesRemovedCount;
        this.rowErrorCount = rowErrorCount;
        this.removalsConfirmed = removalsConfirmed;
        this.executedAt = executedAt;
        this.executedByAccountId = executedByAccountId;
    }
}
