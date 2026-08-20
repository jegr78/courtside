package org.courtside.audit.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminAuditApi;
import org.courtside.api.ApiAuditEntry;
import org.courtside.api.ApiAuditPage;
import org.courtside.audit.internal.AuditService;
import org.courtside.shared.CursorPage;
import org.courtside.shared.WireTypes;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.time.OffsetDateTime;
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
        return ResponseEntity.ok(new ApiAuditPage(page.items().stream()
                .map(AuditAdminController::toResponse)
                .toList())
                .nextCursor(page.nextCursor()));
    }

    private static ApiAuditEntry toResponse(AuditService.AuditEntry entry) {
        return new ApiAuditEntry(entry.id(), WireTypes.toOffsetDateTime(entry.occurredAt()),
                entry.eventType(), entry.parameters(), entry.subjectId())
                .subjectName(entry.subjectName())
                .actorAccountId(entry.actorAccountId())
                .actorUsername(entry.actorUsername());
    }
}
