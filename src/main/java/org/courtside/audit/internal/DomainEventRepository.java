package org.courtside.audit.internal;

import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface DomainEventRepository extends Repository<DomainEvent, UUID> {

    DomainEvent save(DomainEvent event);

    List<DomainEvent> findBySubjectIdOrderByOccurredAtAsc(UUID subjectId);

    List<DomainEvent> findByEventTypeOrderByOccurredAtAsc(String eventType);

    Optional<DomainEvent> findById(UUID id);

    List<DomainEvent> findAllByIdIn(Collection<UUID> ids);

    @Query("""
            SELECT e.id FROM DomainEvent e
            WHERE (:subjectId IS NULL OR e.subjectId = :subjectId)
              AND (CAST(:from AS timestamp) IS NULL OR e.occurredAt >= :from)
              AND (CAST(:to AS timestamp) IS NULL OR e.occurredAt < :to)
              AND (CAST(:cursorOccurredAt AS timestamp) IS NULL
                   OR e.occurredAt < :cursorOccurredAt
                   OR (e.occurredAt = :cursorOccurredAt AND e.id < :cursorId))
            ORDER BY e.occurredAt DESC, e.id DESC
            """)
    List<UUID> findPage(@Param("subjectId") UUID subjectId, @Param("from") Instant from,
                        @Param("to") Instant to, @Param("cursorOccurredAt") Instant cursorOccurredAt,
                        @Param("cursorId") UUID cursorId, Limit limit);
}
