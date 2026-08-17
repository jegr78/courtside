package org.courtside.dataexchange;

import lombok.RequiredArgsConstructor;
import org.courtside.dataexchange.internal.ImportSource;
import org.courtside.dataexchange.internal.ImportSourceRepository;
import org.courtside.member.MemberService;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ImportSourceService {

    private static final Set<CanonicalField> REQUIRED_COLUMNS =
            EnumSet.of(CanonicalField.EXTERNAL_ID, CanonicalField.FIRST_NAME, CanonicalField.LAST_NAME);
    private static final String UNIQUE_KEY_CONSTRAINT = "import_source_unique_key";

    private final ImportSourceRepository sources;
    private final MemberService memberships;
    private final Clock clock;

    public List<SourceConfiguration> all() {
        return sources.findAllByOrderBySourceKeyAsc().stream()
                .map(ImportSourceService::toConfiguration)
                .toList();
    }

    public SourceConfiguration configurationOf(UUID sourceId) {
        return toConfiguration(require(sourceId));
    }

    @Transactional
    public SourceConfiguration create(String sourceKey, String displayName,
                                      Map<String, CanonicalField> columns,
                                      Map<String, UUID> membershipTypes,
                                      Set<CanonicalField> ownedFields, int removalWarningPercent) {
        requireUsable(columns, membershipTypes, ownedFields, removalWarningPercent);
        ImportSource source = new ImportSource(
                requiredText(sourceKey, "import.source.sourceKey.blank", "sourceKey"),
                requiredText(displayName, "import.source.displayName.blank", "displayName"),
                clock.instant());
        source.changeTo(source.getSourceKey(), source.getDisplayName(), columns, membershipTypes,
                ownedFields, removalWarningPercent);
        return toConfiguration(saveOrRejectTakenKey(source));
    }

    @Transactional
    public SourceConfiguration change(UUID sourceId, String sourceKey, String displayName,
                                      Map<String, CanonicalField> columns,
                                      Map<String, UUID> membershipTypes,
                                      Set<CanonicalField> ownedFields, int removalWarningPercent) {
        requireUsable(columns, membershipTypes, ownedFields, removalWarningPercent);
        ImportSource source = require(sourceId);
        source.changeTo(requiredText(sourceKey, "import.source.sourceKey.blank", "sourceKey"),
                requiredText(displayName, "import.source.displayName.blank", "displayName"),
                columns, membershipTypes, ownedFields, removalWarningPercent);
        return toConfiguration(saveOrRejectTakenKey(source));
    }

    @Transactional
    public void delete(UUID sourceId) {
        sources.delete(require(sourceId));
    }

    private void requireUsable(Map<String, CanonicalField> columns,
                               Map<String, UUID> membershipTypes,
                               Set<CanonicalField> ownedFields, int removalWarningPercent) {
        requireCompleteColumns(columns);
        requireUnambiguousColumns(columns);
        requireOwnableFields(ownedFields);
        requireKnownMembershipTypes(membershipTypes);
        requirePercentage(removalWarningPercent);
    }

    private static void requireCompleteColumns(Map<String, CanonicalField> columns) {
        Set<CanonicalField> missing = EnumSet.copyOf(REQUIRED_COLUMNS);
        missing.removeAll(requiredColumns(columns).values());
        if (!missing.isEmpty()) {
            throw new ImportSourceInvalidException("import.source.columns.incomplete",
                    Map.of("field", "columns", "missing", missing.stream().map(Enum::name).sorted().toList()));
        }
    }

    private static void requireUnambiguousColumns(Map<String, CanonicalField> columns) {
        Set<CanonicalField> seen = EnumSet.noneOf(CanonicalField.class);
        columns.values().stream()
                .filter(field -> !seen.add(field))
                .findFirst()
                .ifPresent(duplicate -> {
                    throw new ImportSourceInvalidException("import.source.columns.ambiguous",
                            Map.of("field", "columns", "canonicalField", duplicate.name()));
                });
    }

    private static void requireOwnableFields(Set<CanonicalField> ownedFields) {
        if (requiredOwnedFields(ownedFields).contains(CanonicalField.EXTERNAL_ID)) {
            throw new ImportSourceInvalidException("import.source.ownedFields.externalId",
                    Map.of("field", "ownedFields"));
        }
    }

    private void requireKnownMembershipTypes(Map<String, UUID> membershipTypes) {
        requiredMembershipTypes(membershipTypes).forEach((value, typeId) -> {
            if (typeId == null || !memberships.knowsMembershipType(typeId)) {
                throw new ImportSourceInvalidException("import.source.membershipType.unknown",
                        Map.of("field", "membershipTypes", "sourceValue", value));
            }
        });
    }

    private static void requirePercentage(int removalWarningPercent) {
        if (removalWarningPercent < 0 || removalWarningPercent > 100) {
            throw new ImportSourceInvalidException("import.source.removalWarningPercent.outOfRange",
                    Map.of("field", "removalWarningPercent"));
        }
    }

    private ImportSource require(UUID sourceId) {
        if (sourceId == null) {
            throw new IllegalStateException("An import source must be named by an id");
        }
        return sources.findById(sourceId).orElseThrow(() ->
                new ImportSourceNotFoundException("No import source with id " + sourceId));
    }

    private ImportSource saveOrRejectTakenKey(ImportSource source) {
        try {
            return sources.saveAndFlush(source);
        } catch (DataIntegrityViolationException e) {
            String message = e.getMostSpecificCause().getMessage();
            if (message != null && message.contains(UNIQUE_KEY_CONSTRAINT)) {
                throw new ImportSourceKeyTakenException(
                        "Import source key '" + source.getSourceKey() + "' is already taken", e);
            }
            throw e;
        }
    }

    private static Map<String, CanonicalField> requiredColumns(Map<String, CanonicalField> columns) {
        if (columns == null || columns.isEmpty()) {
            throw new ImportSourceInvalidException("import.source.columns.incomplete",
                    Map.of("field", "columns"));
        }
        return columns;
    }

    private static Map<String, UUID> requiredMembershipTypes(Map<String, UUID> membershipTypes) {
        return membershipTypes == null ? Map.of() : membershipTypes;
    }

    private static Set<CanonicalField> requiredOwnedFields(Set<CanonicalField> ownedFields) {
        return ownedFields == null ? Set.of() : ownedFields;
    }

    private static String requiredText(String value, String code, String field) {
        if (value == null || value.isBlank()) {
            throw new ImportSourceInvalidException(code, Map.of("field", field));
        }
        return value.strip();
    }

    private static SourceConfiguration toConfiguration(ImportSource source) {
        return new SourceConfiguration(source.getId(), source.getSourceKey(),
                source.getDisplayName(), Map.copyOf(source.getColumns()),
                Map.copyOf(source.getMembershipTypes()), new HashSet<>(source.getOwnedFields()),
                source.getRemovalWarningPercent());
    }
}
