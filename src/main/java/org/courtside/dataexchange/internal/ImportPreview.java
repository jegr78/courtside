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
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "import_preview")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ImportPreview {

    @Id
    private UUID id;

    @Column(name = "source_id", nullable = false)
    private UUID sourceId;

    @Enumerated(EnumType.STRING)
    @Column(name = "mode", nullable = false)
    private SnapshotMode mode;

    @Column(name = "file_name", nullable = false)
    private String fileName;

    @Column(name = "file_hash", nullable = false)
    private String fileHash;

    @Column(name = "row_count", nullable = false)
    private int rowCount;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "change_set")
    private String changeSet;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "fingerprints")
    private String fingerprints;

    @Column(name = "removal_count", nullable = false)
    private int removalCount;

    @Column(name = "removal_percent", nullable = false)
    private int removalPercent;

    @Column(name = "removal_warning_pct", nullable = false)
    private int removalWarningPercent;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "created_by_account_id", nullable = false)
    private UUID createdByAccountId;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "superseded_at")
    private Instant supersededAt;

    public ImportPreview(UUID sourceId, SnapshotMode mode, String fileName, String fileHash,
                         int rowCount, String changeSet, String fingerprints, int removalCount,
                         int removalPercent, int removalWarningPercent, Instant createdAt,
                         UUID createdByAccountId, Instant expiresAt) {
        this.id = UUID.randomUUID();
        this.sourceId = sourceId;
        this.mode = mode;
        this.fileName = fileName;
        this.fileHash = fileHash;
        this.rowCount = rowCount;
        this.changeSet = changeSet;
        this.fingerprints = fingerprints;
        this.removalCount = removalCount;
        this.removalPercent = removalPercent;
        this.removalWarningPercent = removalWarningPercent;
        this.createdAt = createdAt;
        this.createdByAccountId = createdByAccountId;
        this.expiresAt = expiresAt;
    }

    public void forget() {
        this.changeSet = null;
        this.fingerprints = null;
    }

    public void supersedeOn(Instant supersededAt) {
        this.supersededAt = supersededAt;
    }

    public boolean needsConfirmation() {
        return removalPercent > removalWarningPercent;
    }

    public boolean isSuperseded() {
        return supersededAt != null;
    }

    public boolean hasExpiredBy(Instant now) {
        return !now.isBefore(expiresAt);
    }
}
