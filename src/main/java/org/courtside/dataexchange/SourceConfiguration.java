package org.courtside.dataexchange;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

public record SourceConfiguration(UUID sourceId, String sourceKey, String displayName,
                                  char separator, String encoding,
                                  ColumnMode columnMode,
                                  Map<String, CanonicalField> columns,
                                  Map<Integer, CanonicalField> positions,
                                  Integer columnCount,
                                  Map<String, UUID> membershipTypes,
                                  Set<String> leftOutCategories,
                                  Map<String, List<AgeBand>> ageBands,
                                  UUID defaultMembershipTypeId,
                                  Set<CanonicalField> ownedFields,
                                  int removalWarningPercent) {

    public SourceConfiguration {
        columnMode = columnMode == null ? ColumnMode.HEADER : columnMode;
        columns = Map.copyOf(columns);
        positions = Map.copyOf(positions);
        membershipTypes = Map.copyOf(membershipTypes);
        leftOutCategories = leftOutCategories == null ? Set.of() : Set.copyOf(leftOutCategories);
        ageBands = ageBands == null ? Map.of() : ageBands.entrySet().stream().collect(Collectors.toUnmodifiableMap(
                Map.Entry::getKey, entry -> entry.getValue().stream()
                        .sorted(Comparator.comparingInt(AgeBand::fromAge)).toList()));
        ownedFields = Set.copyOf(ownedFields);
    }

    public SourceConfiguration(UUID sourceId, String sourceKey, String displayName, char separator,
                               String encoding, Map<String, CanonicalField> columns,
                               Map<String, UUID> membershipTypes, UUID defaultMembershipTypeId,
                               Set<CanonicalField> ownedFields, int removalWarningPercent) {
        this(sourceId, sourceKey, displayName, separator, encoding, ColumnMode.HEADER, columns,
                Map.of(), null, membershipTypes, Set.of(), Map.of(), defaultMembershipTypeId, ownedFields,
                removalWarningPercent);
    }

    public boolean owns(CanonicalField field) {
        return ownedFields.contains(field);
    }
}
