package org.courtside.dataexchange;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

public record SourceConfiguration(UUID sourceId, String sourceKey, String displayName,
                                  char separator, String encoding,
                                  ColumnMode columnMode,
                                  Map<String, CanonicalField> columns,
                                  Map<Integer, CanonicalField> positions,
                                  Integer columnCount,
                                  Map<String, UUID> membershipTypes,
                                  UUID defaultMembershipTypeId,
                                  Set<CanonicalField> ownedFields,
                                  int removalWarningPercent) {

    public SourceConfiguration {
        columnMode = columnMode == null ? ColumnMode.HEADER : columnMode;
        columns = Map.copyOf(columns);
        positions = Map.copyOf(positions);
        membershipTypes = Map.copyOf(membershipTypes);
        ownedFields = Set.copyOf(ownedFields);
    }

    public SourceConfiguration(UUID sourceId, String sourceKey, String displayName, char separator,
                               String encoding, Map<String, CanonicalField> columns,
                               Map<String, UUID> membershipTypes, UUID defaultMembershipTypeId,
                               Set<CanonicalField> ownedFields, int removalWarningPercent) {
        this(sourceId, sourceKey, displayName, separator, encoding, ColumnMode.HEADER, columns,
                Map.of(), null, membershipTypes, defaultMembershipTypeId, ownedFields,
                removalWarningPercent);
    }

    public boolean owns(CanonicalField field) {
        return ownedFields.contains(field);
    }
}
