package org.courtside.dataexchange.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminImportPreviewsApi;
import org.courtside.api.ApiImportChangeKind;
import org.courtside.api.ApiImportPersonChange;
import org.courtside.api.ApiImportPossibleDuplicate;
import org.courtside.api.ApiImportPreview;
import org.courtside.api.ApiImportRemovalCounts;
import org.courtside.api.ApiImportRowError;
import org.courtside.api.ApiSnapshotMode;
import org.courtside.dataexchange.PreviewService;
import org.courtside.dataexchange.PreviewSummary;
import org.courtside.dataexchange.ResolvedChangeSet;
import org.courtside.dataexchange.SnapshotMode;
import org.courtside.identity.CurrentUser;
import org.courtside.shared.WireTypes;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
class ImportPreviewAdminController implements AdminImportPreviewsApi {

    private final PreviewService previews;
    private final CurrentUser currentUser;

    @Override
    public ResponseEntity<ApiImportPreview> createImportPreview(UUID sourceId, MultipartFile file,
                                                                ApiSnapshotMode mode) {
        PreviewSummary summary = previews.create(sourceId, SnapshotMode.valueOf(mode.getValue()),
                file.getOriginalFilename(), bytesOf(file), currentUser.requireAccount().getId());
        return ResponseEntity
                .created(java.net.URI.create("/api/admin/import/previews/" + summary.previewId()))
                .body(toResponse(summary));
    }

    @Override
    public ResponseEntity<ApiImportPreview> readImportPreview(UUID id) {
        return ResponseEntity.ok(toResponse(previews.read(id)));
    }

    private static byte[] bytesOf(MultipartFile file) {
        try {
            return file.getBytes();
        } catch (IOException e) {
            throw new UncheckedIOException("The uploaded snapshot could not be read", e);
        }
    }

    private static ApiImportPreview toResponse(PreviewSummary summary) {
        ResolvedChangeSet changeSet = summary.changeSet();
        return new ApiImportPreview(summary.previewId(), summary.sourceId(),
                ApiSnapshotMode.fromValue(summary.mode().name()), summary.fileName(),
                summary.fileHash(), summary.rowCount(), summary.ignoredColumns(),
                changesOf(changeSet), rowErrorsOf(changeSet), duplicatesOf(changeSet),
                removalsOf(changeSet), summary.needsConfirmation(), summary.superseded(),
                WireTypes.toOffsetDateTime(summary.createdAt()),
                WireTypes.toOffsetDateTime(summary.expiresAt()));
    }

    private static List<ApiImportPersonChange> changesOf(ResolvedChangeSet changeSet) {
        if (changeSet == null) {
            return List.of();
        }
        return changeSet.changes().stream().map(change -> {
            Map<String, String> values = new LinkedHashMap<>();
            change.values().forEach((field, value) -> values.put(field.name(), value));
            return new ApiImportPersonChange(ApiImportChangeKind.fromValue(change.kind().name()),
                    change.rowNumber(), change.externalId(), values)
                    .personId(change.personId())
                    .membershipTypeId(change.membershipTypeId());
        }).toList();
    }

    private static List<ApiImportRowError> rowErrorsOf(ResolvedChangeSet changeSet) {
        if (changeSet == null) {
            return List.of();
        }
        return changeSet.errors().stream()
                .map(error -> new ApiImportRowError(error.rowNumber(), error.code(), error.params()))
                .toList();
    }

    private static List<ApiImportPossibleDuplicate> duplicatesOf(ResolvedChangeSet changeSet) {
        if (changeSet == null) {
            return List.of();
        }
        return changeSet.duplicates().stream()
                .map(duplicate -> new ApiImportPossibleDuplicate(duplicate.rowNumber(),
                        duplicate.externalId(), duplicate.personId()))
                .toList();
    }

    private static ApiImportRemovalCounts removalsOf(ResolvedChangeSet changeSet) {
        ResolvedChangeSet.RemovalCounts removals = changeSet == null
                ? new ResolvedChangeSet.RemovalCounts(0, 0, 0)
                : changeSet.removals();
        return new ApiImportRemovalCounts(removals.count(), removals.currentlyLinked(),
                removals.percent());
    }
}
