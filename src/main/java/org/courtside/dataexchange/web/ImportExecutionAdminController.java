package org.courtside.dataexchange.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminImportRunsApi;
import org.courtside.api.ApiExecutionRequest;
import org.courtside.api.ApiImportRun;
import org.courtside.api.ApiSnapshotMode;
import org.courtside.dataexchange.ExecutionService;
import org.courtside.dataexchange.RunOutcome;
import org.courtside.identity.CurrentUser;
import org.courtside.shared.WireTypes;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
class ImportExecutionAdminController implements AdminImportRunsApi {

    private final ExecutionService executions;
    private final CurrentUser currentUser;

    @Override
    public ResponseEntity<ApiImportRun> executeImportPreview(UUID id, ApiExecutionRequest request) {
        return ResponseEntity.ok(toResponse(executions.execute(id, confirmRemovals(request),
                currentUser.requireAccount().getId())));
    }

    @Override
    public ResponseEntity<List<ApiImportRun>> listImportRuns(UUID sourceId) {
        return ResponseEntity.ok(executions.runsOf(sourceId).stream()
                .map(ImportExecutionAdminController::toResponse)
                .toList());
    }

    private static boolean confirmRemovals(ApiExecutionRequest request) {
        return request != null && Boolean.TRUE.equals(request.getConfirmRemovals());
    }

    private static ApiImportRun toResponse(RunOutcome outcome) {
        return new ApiImportRun(outcome.runId(), outcome.sourceId(), outcome.previewId(),
                ApiSnapshotMode.fromValue(outcome.mode().name()), outcome.fileHash(),
                outcome.created(), outcome.corrected(), outcome.membershipsEnded(),
                outcome.accountsDisabled(), outcome.rolesRemoved(), outcome.rowErrors(),
                outcome.removalsConfirmed(), WireTypes.toOffsetDateTime(outcome.executedAt()));
    }
}
