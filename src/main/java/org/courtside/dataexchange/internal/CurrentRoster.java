package org.courtside.dataexchange.internal;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public record CurrentRoster(Map<String, UUID> personIdsByExternalId,
                            Map<UUID, RosterPerson> peopleById,
                            Set<UUID> activeMembershipTypeIds,
                            Map<String, List<UUID>> personIdsByNameKey,
                            Set<UUID> membershipTypeIdsGrantingAnAccount,
                            Set<UUID> personIdsHoldingAnAccount) {

    public CurrentRoster {
        personIdsByExternalId = Map.copyOf(personIdsByExternalId);
        peopleById = Map.copyOf(peopleById);
        activeMembershipTypeIds = Set.copyOf(activeMembershipTypeIds);
        personIdsByNameKey = Map.copyOf(personIdsByNameKey);
        membershipTypeIdsGrantingAnAccount = Set.copyOf(membershipTypeIdsGrantingAnAccount);
        personIdsHoldingAnAccount = Set.copyOf(personIdsHoldingAnAccount);
    }

    public record RosterPerson(UUID personId, String firstName, String lastName, String email,
                               UUID membershipTypeId, boolean membershipCurrent) {
    }
}
