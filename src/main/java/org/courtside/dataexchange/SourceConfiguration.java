package org.courtside.dataexchange;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

public record SourceConfiguration(UUID sourceId, String sourceKey, String displayName,
                                  Map<String, CanonicalField> columns,
                                  Map<String, UUID> membershipTypes,
                                  UUID defaultMembershipTypeId,
                                  Set<CanonicalField> ownedFields,
                                  int removalWarningPercent) {

    public SourceConfiguration {
        columns = Map.copyOf(columns);
        membershipTypes = Map.copyOf(membershipTypes);
        ownedFields = Set.copyOf(ownedFields);
    }

    public boolean owns(CanonicalField field) {
        return ownedFields.contains(field);
    }
}
