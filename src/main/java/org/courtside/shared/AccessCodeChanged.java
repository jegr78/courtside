package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.util.List;
import java.util.UUID;

// Names the courts the access point serves and never the code: the message reads the code when it is written.
@NullMarked
public record AccessCodeChanged(UUID accessPointId, List<UUID> courtIds) implements DomainEventRecord {

    static final String TYPE = "facility.accessPoint.codeChanged";

    public AccessCodeChanged {
        courtIds = List.copyOf(courtIds);
    }

    @Override
    public String eventType() {
        return TYPE;
    }

    @Override
    public UUID subjectId() {
        return accessPointId;
    }
}
