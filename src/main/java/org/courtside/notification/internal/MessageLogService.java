package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.notification.MessageState;
import org.courtside.shared.CursorPage;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MessageLogService {

    private static final int MAX_PAGE_SIZE = 100;

    private final MessageRecordRepository records;
    private final UserAccountRepository accounts;

    public CursorPage.Result<MessageEntry> page(MessageState state, boolean unsettled, UUID personId,
                                                Instant from, Instant to, UUID cursor, int limit) {
        validateLimit(limit);
        MessageRecord start = cursorRecord(cursor);
        List<UUID> ids = records.findPage(personId != null, accountIdsFor(personId), state, unsettled,
                from, to, start == null ? null : start.getQueuedSeq(), Limit.of(limit + 1));
        return CursorPage.of(ids, limit, this::load, MessageEntry::id);
    }

    private List<UUID> accountIdsFor(UUID personId) {
        if (personId == null) {
            return List.of();
        }
        return accounts.findByPersonIdIn(List.of(personId)).stream().map(UserAccount::getId).toList();
    }

    private MessageRecord cursorRecord(UUID cursor) {
        if (cursor == null) {
            return null;
        }
        return records.findById(cursor)
                .orElseThrow(() -> new MessageCursorUnknownException("message.cursor.unknown", Map.of()));
    }

    private List<MessageEntry> load(List<UUID> ids) {
        List<MessageRecord> found = records.findAllByIdIn(ids);
        Map<UUID, UserAccount> byAccountId = accounts.findAllById(found.stream()
                        .map(MessageRecord::getAccountId)
                        .collect(Collectors.toSet())).stream()
                .collect(Collectors.toMap(UserAccount::getId, account -> account));
        return found.stream()
                .filter(record -> byAccountId.containsKey(record.getAccountId()))
                .map(record -> toEntry(record, byAccountId.get(record.getAccountId())))
                .toList();
    }

    private static MessageEntry toEntry(MessageRecord record, UserAccount account) {
        return new MessageEntry(record.getId(), record.getQueuedAt(), record.getSettledAt(),
                record.getKind(), record.getState(), record.getMessageId(),
                record.getReason(), record.getStatusCode(),
                account.getPerson().getId(), account.getPerson().getDisplayName());
    }

    private static void validateLimit(int limit) {
        if (limit < 1 || limit > MAX_PAGE_SIZE) {
            throw new IllegalStateException("Message page size must be between 1 and " + MAX_PAGE_SIZE);
        }
    }

    public record MessageEntry(UUID id, Instant queuedAt, Instant settledAt, MessageKind kind,
                               MessageState state, String messageId, String reason, String statusCode,
                               UUID personId, String personName) {
    }
}
