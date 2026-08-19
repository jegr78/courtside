package org.courtside.shared;

import java.util.UUID;

public interface DomainEventRecord {

    String eventType();

    UUID subjectId();
}
