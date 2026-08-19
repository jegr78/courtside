package org.courtside.audit.internal;

import org.springframework.data.repository.Repository;

import java.util.List;
import java.util.UUID;

public interface DomainEventRepository extends Repository<DomainEvent, UUID> {

    DomainEvent save(DomainEvent event);

    List<DomainEvent> findBySubjectIdOrderByOccurredAtAsc(UUID subjectId);
}
