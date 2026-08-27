package org.courtside.audit;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface PersonAuditTrail {

    // Two shapes rather than one: an entry somebody else is the subject of has nowhere to put its
    // payload, so leaving that projection out is not something a caller can forget.
    record SubjectEntry(Instant occurredAt, String eventType, Map<String, Object> parameters) {
    }

    record ActorEntry(Instant occurredAt, String eventType) {
    }

    List<SubjectEntry> recordedAbout(UUID subjectId);

    List<ActorEntry> recordedBy(UUID actorAccountId);
}
