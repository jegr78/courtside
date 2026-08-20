package org.courtside.audit.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.ConfigurationSubjectNames;
import org.courtside.shared.CursorPage;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class AuditService {

    private static final int MAX_PAGE_SIZE = 100;

    private final DomainEventRepository events;
    private final UserAccountRepository accounts;
    private final List<ConfigurationSubjectNames> subjectNames;
    private final ObjectMapper json;

    public Map<UUID, String> namesFor(Collection<UUID> subjectIds) {
        if (subjectIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, String> resolved = new HashMap<>();
        subjectNames.forEach(source -> resolved.putAll(source.namesFor(subjectIds)));
        // Map.copyOf rejects a null value, and an unnamed subject is an ordinary, expected one.
        return Collections.unmodifiableMap(resolved);
    }

    public CursorPage.Result<AuditEntry> page(UUID subjectId, Instant from, Instant to, UUID cursor, int limit) {
        validateLimit(limit);
        DomainEvent cursorEvent = cursorEvent(cursor);
        List<UUID> ids = events.findPage(subjectId, from, to,
                cursorEvent == null ? null : cursorEvent.getOccurredAt(),
                cursorEvent == null ? null : cursorEvent.getId(),
                Limit.of(limit + 1));
        return CursorPage.of(ids, limit, this::load, AuditEntry::id);
    }

    private DomainEvent cursorEvent(UUID cursor) {
        if (cursor == null) {
            return null;
        }
        return events.findById(cursor)
                .orElseThrow(() -> new AuditCursorUnknownException("audit.cursor.unknown", Map.of()));
    }

    private List<AuditEntry> load(List<UUID> ids) {
        List<DomainEvent> found = events.findAllByIdIn(ids);
        Map<UUID, String> subjectNamesById = namesFor(found.stream()
                .map(DomainEvent::getSubjectId)
                .collect(Collectors.toSet()));
        Set<UUID> actorIds = found.stream()
                .map(DomainEvent::getActorAccountId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<UUID, String> actorUsernames = accounts.findAllById(actorIds).stream()
                .collect(Collectors.toMap(UserAccount::getId, UserAccount::getUsername));
        return found.stream()
                .map(event -> toEntry(event, subjectNamesById, actorUsernames))
                .toList();
    }

    private AuditEntry toEntry(DomainEvent event, Map<UUID, String> subjectNamesById,
                               Map<UUID, String> actorUsernames) {
        UUID actorAccountId = event.getActorAccountId();
        return new AuditEntry(event.getId(), event.getOccurredAt(), event.getEventType(),
                payloadOf(event.getPayload()), event.getSubjectId(),
                subjectNamesById.get(event.getSubjectId()),
                actorAccountId, actorAccountId == null ? null : actorUsernames.get(actorAccountId));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> payloadOf(String payload) {
        return json.readValue(payload, Map.class);
    }

    private static void validateLimit(int limit) {
        if (limit < 1 || limit > MAX_PAGE_SIZE) {
            throw new IllegalStateException("Audit page size must be between 1 and " + MAX_PAGE_SIZE);
        }
    }

    public record AuditEntry(UUID id, Instant occurredAt, String eventType, Map<String, Object> parameters,
                             UUID subjectId, String subjectName, UUID actorAccountId, String actorUsername) {
    }
}
