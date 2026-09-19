package org.courtside.operations.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminOperationalLogsApi;
import org.courtside.api.ApiOperationalLogAvailability;
import org.courtside.api.ApiOperationalLogEntry;
import org.courtside.api.ApiOperationalLogPage;
import org.courtside.api.ApiOperationalLogSearchRequest;
import org.courtside.api.ApiOperationalLogSeverity;
import org.courtside.api.ApiOperationalLogSource;
import org.courtside.operations.internal.OperationalLogService;
import org.courtside.operations.internal.OperationalLogSeverity;
import org.courtside.operations.internal.OperationalLogSource;
import org.courtside.shared.WireTypes;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
class OperationalLogAdminController implements AdminOperationalLogsApi {

    private final OperationalLogService logs;

    @Override
    public ResponseEntity<ApiOperationalLogPage> searchOperationalLogs(ApiOperationalLogSearchRequest request) {
        OperationalLogService.Page page = logs.search(new OperationalLogService.Query(
                source(request.getSource()),
                severity(request.getSeverity()),
                WireTypes.toInstant(request.getFrom()),
                WireTypes.toInstant(request.getTo()),
                request.getText(),
                request.getTraceId(),
                request.getCursor(),
                request.getLimit()));
        ApiOperationalLogPage response = new ApiOperationalLogPage(
                page.entries().stream().map(OperationalLogAdminController::entry).toList(),
                ApiOperationalLogAvailability.fromValue(page.availability().name()),
                page.retentionTruncated(),
                page.searchIncomplete(),
                page.droppedRecords())
                .nextCursor(page.nextCursor())
                .oldestAvailableAt(WireTypes.toOffsetDateTime(page.oldestAvailableAt()));
        return ResponseEntity.ok(response);
    }

    private static ApiOperationalLogEntry entry(OperationalLogService.Entry entry) {
        return new ApiOperationalLogEntry(
                entry.id(),
                WireTypes.toOffsetDateTime(entry.occurredAt()),
                ApiOperationalLogSource.fromValue(entry.source().name()),
                ApiOperationalLogSeverity.fromValue(entry.severity().name()),
                entry.message())
                .traceId(entry.traceId());
    }

    private static OperationalLogSource source(ApiOperationalLogSource source) {
        return source == null ? null : OperationalLogSource.valueOf(source.getValue());
    }

    private static OperationalLogSeverity severity(ApiOperationalLogSeverity severity) {
        return severity == null ? null : OperationalLogSeverity.valueOf(severity.getValue());
    }
}
