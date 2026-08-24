package org.courtside.member;

import java.util.Map;
import java.util.UUID;

public record RosterSyncOutcome(Map<String, UUID> createdPersonIdsByExternalId, int created,
                                int corrected, int membershipsEnded, int accountsCreated,
                                int accountsDisabled, int rolesRemoved) {

    public RosterSyncOutcome {
        createdPersonIdsByExternalId = Map.copyOf(createdPersonIdsByExternalId);
    }
}
