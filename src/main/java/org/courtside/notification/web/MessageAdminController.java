package org.courtside.notification.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminMessagesApi;
import org.courtside.api.ApiMessageEntry;
import org.courtside.api.ApiMessageKind;
import org.courtside.api.ApiMessagePage;
import org.courtside.api.ApiMessageState;
import org.courtside.notification.MessageState;
import org.courtside.notification.internal.MessageLogService;
import org.courtside.shared.CursorPage;
import org.courtside.shared.WireTypes;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.time.OffsetDateTime;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
class MessageAdminController implements AdminMessagesApi {

    private final MessageLogService messages;

    @Override
    public ResponseEntity<ApiMessagePage> readMessageLog(
            ApiMessageState state, Boolean unsettled, UUID personId,
            OffsetDateTime from, OffsetDateTime to, UUID cursor, Integer limit) {
        CursorPage.Result<MessageLogService.MessageEntry> page = messages.page(
                state == null ? null : MessageState.valueOf(state.getValue()),
                Boolean.TRUE.equals(unsettled), personId,
                WireTypes.toInstant(from), WireTypes.toInstant(to), cursor, limit);
        return ResponseEntity.ok(new ApiMessagePage(page.items().stream()
                .map(MessageAdminController::toResponse)
                .toList())
                .nextCursor(page.nextCursor()));
    }

    private static ApiMessageEntry toResponse(MessageLogService.MessageEntry entry) {
        return new ApiMessageEntry(entry.id(), WireTypes.toOffsetDateTime(entry.queuedAt()),
                ApiMessageKind.fromValue(entry.kind().name()),
                ApiMessageState.fromValue(entry.state().name()),
                entry.messageId(), entry.personId(), entry.personName())
                .settledAt(WireTypes.toOffsetDateTime(entry.settledAt()))
                .reason(entry.reason())
                .statusCode(entry.statusCode());
    }
}
