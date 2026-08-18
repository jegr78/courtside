package org.courtside.member;

import java.util.List;
import java.util.UUID;

public record RosterChangeSet(List<NewPerson> creations, List<PersonCorrection> corrections,
                              List<UUID> membershipEndings) {

    public RosterChangeSet {
        creations = List.copyOf(creations);
        corrections = List.copyOf(corrections);
        membershipEndings = List.copyOf(membershipEndings);
    }

    public record NewPerson(String externalId, String firstName, String lastName, String email,
                            UUID membershipTypeId) {
    }

    public record PersonCorrection(UUID personId, String firstName, String lastName, String email,
                                   UUID membershipTypeId) {
    }
}
