package org.courtside.audit.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminAuditApi;
import org.courtside.api.ApiAuditEntry;
import org.courtside.api.ApiAuditPage;
import org.courtside.api.ApiAuditSearchRequest;
import org.courtside.audit.internal.AuditService;
import org.courtside.shared.CursorPage;
import org.courtside.shared.WireTypes;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
class AuditAdminController implements AdminAuditApi {

    private final AuditService audit;

    @Override
    public ResponseEntity<ApiAuditPage> readAuditLog(
            UUID subjectId, OffsetDateTime from, OffsetDateTime to, UUID cursor, Integer limit) {
        CursorPage.Result<AuditService.AuditEntry> page = audit.page(
                subjectId, WireTypes.toInstant(from), WireTypes.toInstant(to), cursor, limit);
        return response(page);
    }

    @Override
    public ResponseEntity<ApiAuditPage> searchAuditLog(ApiAuditSearchRequest request) {
        AuditService.SearchResult result = audit.search(
                request.getQuery(), request.getEventType(), request.getSubjectId(),
                WireTypes.toInstant(request.getFrom()), WireTypes.toInstant(request.getTo()),
                request.getCursor(), request.getLimit());
        return ResponseEntity.ok(page(result.items(), result.nextCursor()).searchIncomplete(result.incomplete()));
    }

    private static ResponseEntity<ApiAuditPage> response(CursorPage.Result<AuditService.AuditEntry> page) {
        return ResponseEntity.ok(page(page.items(), page.nextCursor()));
    }

    private static ApiAuditPage page(List<AuditService.AuditEntry> entries, UUID nextCursor) {
        return new ApiAuditPage(entries.stream()
                .map(AuditAdminController::toResponse)
                .toList())
                .nextCursor(nextCursor);
    }

    private static ApiAuditEntry toResponse(AuditService.AuditEntry entry) {
        return new ApiAuditEntry(entry.id(), WireTypes.toOffsetDateTime(entry.occurredAt()),
                entry.eventType(), entry.parameters(), entry.subjectId())
                .subjectName(entry.subjectName())
                .actorAccountId(entry.actorAccountId())
                .actorUsername(entry.actorUsername());
    }
}
