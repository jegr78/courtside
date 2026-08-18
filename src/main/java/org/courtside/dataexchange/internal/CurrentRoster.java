package org.courtside.dataexchange.internal;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public record CurrentRoster(Map<String, UUID> personIdsByExternalId,
                            Map<UUID, RosterPerson> peopleById,
                            Set<UUID> activeMembershipTypeIds,
                            Map<String, List<UUID>> personIdsByNameKey) {

    public CurrentRoster {
        personIdsByExternalId = Map.copyOf(personIdsByExternalId);
        peopleById = Map.copyOf(peopleById);
        activeMembershipTypeIds = Set.copyOf(activeMembershipTypeIds);
        personIdsByNameKey = Map.copyOf(personIdsByNameKey);
    }

    public record RosterPerson(UUID personId, String firstName, String lastName, String email,
                               UUID membershipTypeId, boolean membershipCurrent) {
    }
}
