package org.courtside.dataexchange;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public record ResolvedChangeSet(List<PersonChange> changes, List<RowError> errors,
                                List<PossibleDuplicate> duplicates,
                                List<SharedAddress> sharedAddresses, RemovalCounts removals) {

    public ResolvedChangeSet {
        changes = List.copyOf(changes);
        errors = List.copyOf(errors);
        duplicates = List.copyOf(duplicates);
        sharedAddresses = sharedAddresses == null ? List.of() : List.copyOf(sharedAddresses);
    }

    public enum ChangeKind {
        CREATE,
        UPDATE,
        END_MEMBERSHIP
    }

    // What an execution would do about this row's account, and when it would do nothing, why. A
    // board reads it beside the row rather than as a second list it has to line up itself.
    public enum AccountOutcome {
        CREATE,
        MEMBERSHIP_TYPE_GRANTS_NONE,
        NO_ADDRESS,
        POSSIBLE_DUPLICATE,
        ALREADY_HELD,
        NOT_ASKED
    }

    public record PersonChange(ChangeKind kind, int rowNumber, String externalId, UUID personId,
                               Map<CanonicalField, String> values, UUID membershipTypeId,
                               AccountOutcome account) {

        // A change set stored before this instance knew the question carries no answer, and
        // nobody asked is what that is - reading one back must not be a 500.
        public PersonChange {
            values = Map.copyOf(values);
            account = account == null ? AccountOutcome.NOT_ASKED : account;
        }
    }

    public record RowError(int rowNumber, String code, Map<String, Object> params) {

        public RowError {
            params = Map.copyOf(params);
        }
    }

    public record PossibleDuplicate(int rowNumber, String externalId, UUID personId) {
    }

    // A mailbox several people read receives every credential sent to it, and a first credential
    // is enough to keep an account - so a board sees the count before this run sends anything.
    public record SharedAddress(int rowNumber, String externalId, int sharedBy) {
    }

    public record RemovalCounts(int count, int currentlyLinked, int percent) {
    }
}
