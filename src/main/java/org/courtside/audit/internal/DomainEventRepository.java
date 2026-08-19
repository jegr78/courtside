package org.courtside.audit.internal;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface DomainEventRepository extends JpaRepository<DomainEvent, UUID> {

    List<DomainEvent> findBySubjectIdOrderByOccurredAtAsc(UUID subjectId);
}
