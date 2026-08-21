package org.courtside.audit.testfixture;

import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import lombok.RequiredArgsConstructor;
import org.courtside.audit.internal.AuditService;
import org.courtside.audit.internal.DomainEvent;
import org.courtside.audit.internal.DomainEventRepository;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@RequiredArgsConstructor
public class AuditTestFixture {

    private static final ObjectMapper JSON = JsonMapper.builder().build();

    private final DomainEventRepository events;
    private final AuditService audit;

    public List<RecordedEvent> eventsAbout(UUID subjectId) {
        return events.findBySubjectIdOrderByOccurredAtAscIdAsc(subjectId).stream()
                .map(this::toRecordedEvent)
                .toList();
    }

    public List<RecordedEvent> eventsAbout(UUID subjectId, String eventType) {
        return eventsAbout(subjectId).stream()
                .filter(event -> event.eventType().equals(eventType))
                .toList();
    }

    public List<RecordedEvent> eventsOfType(String eventType) {
        return events.findByEventTypeOrderByOccurredAtAscIdAsc(eventType).stream()
                .map(this::toRecordedEvent)
                .toList();
    }

    public Map<String, Long> eventCountsAbout(UUID subjectId) {
        return eventsAbout(subjectId).stream()
                .collect(Collectors.groupingBy(RecordedEvent::eventType, Collectors.counting()));
    }

    public Map<String, Object> latestPayload(UUID subjectId, String eventType) {
        return eventsAbout(subjectId, eventType).stream()
                .reduce((first, second) -> second)
                .map(RecordedEvent::payload)
                .orElseThrow();
    }

    public String nameOf(UUID subjectId) {
        return audit.namesFor(List.of(subjectId)).get(subjectId);
    }

    private RecordedEvent toRecordedEvent(DomainEvent event) {
        return new RecordedEvent(event.getEventType(), event.getActorAccountId(), payloadOf(event.getPayload()));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> payloadOf(String payload) {
        return JSON.readValue(payload, Map.class);
    }

    public record RecordedEvent(String eventType, UUID actorAccountId, Map<String, Object> payload) {
    }
}
