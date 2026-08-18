package org.courtside.dataexchange;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public record ResolvedChangeSet(List<PersonChange> changes, List<RowError> errors,
                                List<PossibleDuplicate> duplicates, RemovalCounts removals) {

    public ResolvedChangeSet {
        changes = List.copyOf(changes);
        errors = List.copyOf(errors);
        duplicates = List.copyOf(duplicates);
    }

    public enum ChangeKind {
        CREATE,
        UPDATE,
        END_MEMBERSHIP
    }

    public record PersonChange(ChangeKind kind, int rowNumber, String externalId, UUID personId,
                               Map<CanonicalField, String> values, UUID membershipTypeId) {

        public PersonChange {
            values = Map.copyOf(values);
        }
    }

    public record RowError(int rowNumber, String code, Map<String, Object> params) {

        public RowError {
            params = Map.copyOf(params);
        }
    }

    public record PossibleDuplicate(int rowNumber, String externalId, UUID personId) {
    }

    public record RemovalCounts(int count, int currentlyLinked, int percent) {
    }
}
