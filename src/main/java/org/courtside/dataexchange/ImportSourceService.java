package org.courtside.dataexchange;

import lombok.RequiredArgsConstructor;
import org.courtside.dataexchange.internal.ExternalReferenceRepository;
import org.courtside.dataexchange.internal.ImportSource;
import org.courtside.dataexchange.internal.ImportRunRepository;
import org.courtside.dataexchange.internal.ImportSourceRepository;
import org.courtside.dataexchange.internal.ReportedValue;
import org.courtside.member.MemberService;
import org.courtside.shared.SqlConstraintViolation;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ImportSourceService {

    private static final Set<CanonicalField> REQUIRED_COLUMNS =
            EnumSet.of(CanonicalField.EXTERNAL_ID, CanonicalField.FIRST_NAME,
                    CanonicalField.LAST_NAME);
    private static final String UNIQUE_KEY_CONSTRAINT = "import_source_unique_key";
    private static final int MAX_KEY_LENGTH = 40;
    private static final int MAX_DISPLAY_NAME_LENGTH = 80;
    private static final int MAX_ENTRY_LENGTH = 120;
    private static final int MAX_MEMBERSHIP_TYPE_MAPPINGS = 200;

    private record DescribedField(String name, Function<SourceConfiguration, Object> read) {
    }

    // The log names which part of the description moved, never what it moved to: a column mapping
    // and a category assignment both carry the club's own vocabulary.
    private static final List<DescribedField> DESCRIBED_FIELDS = List.of(
            new DescribedField("sourceKey", SourceConfiguration::sourceKey),
            new DescribedField("displayName", SourceConfiguration::displayName),
            new DescribedField("separator", SourceConfiguration::separator),
            new DescribedField("encoding", SourceConfiguration::encoding),
            new DescribedField("columns", SourceConfiguration::columns),
            new DescribedField("membershipTypes", SourceConfiguration::membershipTypes),
            new DescribedField("defaultMembershipTypeId", SourceConfiguration::defaultMembershipTypeId),
            new DescribedField("ownedFields", SourceConfiguration::ownedFields),
            new DescribedField("removalWarningPercent", SourceConfiguration::removalWarningPercent));

    private final ImportSourceRepository sources;
    private final ExternalReferenceRepository references;
    private final ImportRunRepository runs;
    private final MemberService memberships;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public List<SourceConfiguration> all() {
        return sources.findAllByOrderBySourceKeyAsc().stream()
                .map(ImportSourceService::toConfiguration)
                .toList();
    }

    public SourceConfiguration configurationOf(UUID sourceId) {
        return toConfiguration(require(sourceId));
    }

    // Whoever holds this row decides alone what this source's previews look like, so two uploads
    // arriving together queue instead of both believing they superseded the other.
    @Transactional
    public SourceConfiguration configurationForUpdate(UUID sourceId) {
        if (sourceId == null) {
            throw new IllegalStateException("An import source must be named by an id");
        }
        return toConfiguration(sources.findWithLockById(sourceId).orElseThrow(() ->
                new ImportSourceNotFoundException("No import source with id " + sourceId)));
    }

    @Transactional
    public SourceConfiguration create(String sourceKey, String displayName, String separator,
                                      String encoding, Map<String, CanonicalField> columns,
                                      Map<String, UUID> membershipTypes,
                                      UUID defaultMembershipTypeId,
                                      Set<CanonicalField> ownedFields, int removalWarningPercent) {
        Map<String, CanonicalField> storedColumns = strippedColumns(columns);
        Map<String, UUID> storedTypes = strippedMembershipTypes(membershipTypes);
        requireUsable(storedColumns, storedTypes, defaultMembershipTypeId, ownedFields,
                removalWarningPercent);
        ImportSource source = new ImportSource(clock.instant());
        source.changeTo(requiredKey(sourceKey), requiredDisplayName(displayName),
                requiredSeparator(separator), requiredEncoding(encoding), storedColumns, storedTypes,
                defaultMembershipTypeId, ownedFields, removalWarningPercent);
        SourceConfiguration described = toConfiguration(saveOrRejectTakenKey(source));
        events.publishEvent(
                new DataExchangeEvent.SourceDescribed(described.sourceId(), described.sourceKey()));
        return described;
    }

    @Transactional
    public SourceConfiguration change(UUID sourceId, String sourceKey, String displayName,
                                      String separator, String encoding,
                                      Map<String, CanonicalField> columns,
                                      Map<String, UUID> membershipTypes,
                                      UUID defaultMembershipTypeId,
                                      Set<CanonicalField> ownedFields, int removalWarningPercent) {
        Map<String, CanonicalField> storedColumns = strippedColumns(columns);
        Map<String, UUID> storedTypes = strippedMembershipTypes(membershipTypes);
        requireUsable(storedColumns, storedTypes, defaultMembershipTypeId, ownedFields,
                removalWarningPercent);
        ImportSource source = require(sourceId);
        SourceConfiguration before = toConfiguration(source);
        source.changeTo(requiredKey(sourceKey), requiredDisplayName(displayName),
                requiredSeparator(separator), requiredEncoding(encoding), storedColumns, storedTypes,
                defaultMembershipTypeId, ownedFields, removalWarningPercent);
        SourceConfiguration after = toConfiguration(saveOrRejectTakenKey(source));
        List<String> changedFields = differingFields(before, after);
        if (!changedFields.isEmpty()) {
            events.publishEvent(new DataExchangeEvent.SourceChanged(after.sourceId(),
                    after.sourceKey(), changedFields));
        }
        return after;
    }

    @Transactional
    public void delete(UUID sourceId) {
        ImportSource source = require(sourceId);
        if (references.existsBySourceId(source.getId())) {
            throw new ImportSourceInUseException(
                    "Import source " + source.getId() + " still holds external references");
        }
        if (runs.existsBySourceId(source.getId())) {
            throw new ImportSourceInUseException(
                    "Import source " + source.getId() + " has been executed against");
        }
        sources.delete(source);
        events.publishEvent(
                new DataExchangeEvent.SourceDeleted(source.getId(), source.getSourceKey()));
    }

    private static List<String> differingFields(SourceConfiguration before, SourceConfiguration after) {
        return DESCRIBED_FIELDS.stream()
                .filter(field -> !Objects.equals(field.read().apply(before), field.read().apply(after)))
                .map(DescribedField::name)
                .toList();
    }

    private void requireUsable(Map<String, CanonicalField> columns,
                               Map<String, UUID> membershipTypes, UUID defaultMembershipTypeId,
                               Set<CanonicalField> ownedFields, int removalWarningPercent) {
        requireCompleteColumns(columns);
        requireUnambiguousColumns(columns);
        requireOwnableFields(ownedFields);
        requireKnownMembershipTypes(membershipTypes);
        requireKnownDefaultMembershipType(defaultMembershipTypeId);
        requirePercentage(removalWarningPercent);
    }

    private void requireKnownDefaultMembershipType(UUID defaultMembershipTypeId) {
        if (defaultMembershipTypeId == null || !memberships.knowsMembershipType(defaultMembershipTypeId)) {
            throw new ImportSourceInvalidException("import.source.defaultMembershipType.unknown",
                    Map.of("field", "defaultMembershipTypeId"));
        }
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
        Map<String, UUID> requested = requiredMembershipTypes(membershipTypes);
        if (requested.size() > MAX_MEMBERSHIP_TYPE_MAPPINGS) {
            throw new ImportSourceInvalidException("import.source.membershipTypes.tooMany",
                    Map.of("field", "membershipTypes", "maxEntries", MAX_MEMBERSHIP_TYPE_MAPPINGS));
        }
        requested.forEach((value, typeId) -> {
            if (typeId == null || !memberships.knowsMembershipType(typeId)) {
                throw new ImportSourceInvalidException("import.source.membershipType.unknown",
                        Map.of("field", "membershipTypes", "sourceValue", ReportedValue.printable(value)));
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
            if (SqlConstraintViolation.matches(
                    e, SqlConstraintViolation.UNIQUE_VIOLATION, UNIQUE_KEY_CONSTRAINT)) {
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

    private static String requiredKey(String sourceKey) {
        return requiredText(sourceKey, MAX_KEY_LENGTH, "import.source.sourceKey.blank",
                "import.source.sourceKey.tooLong", "sourceKey");
    }

    private static String requiredDisplayName(String displayName) {
        return requiredText(displayName, MAX_DISPLAY_NAME_LENGTH, "import.source.displayName.blank",
                "import.source.displayName.tooLong", "displayName");
    }

    private static String requiredText(String value, int maxLength, String blankCode,
                                       String tooLongCode, String field) {
        if (value == null || value.isBlank()) {
            throw new ImportSourceInvalidException(blankCode, Map.of("field", field));
        }
        String stripped = value.strip();
        if (stripped.length() > maxLength) {
            throw new ImportSourceInvalidException(tooLongCode,
                    Map.of("field", field, "maxLength", maxLength));
        }
        return stripped;
    }

    // The file's headers arrive stripped, so a mapping stored with padding would silently never
    // match the column it names.
    private static Map<String, CanonicalField> strippedColumns(Map<String, CanonicalField> columns) {
        return strippedKeys(requiredColumns(columns), "columns",
                "import.source.columns.headerUnusable", "import.source.columns.headerRepeated");
    }

    private static Map<String, UUID> strippedMembershipTypes(Map<String, UUID> membershipTypes) {
        return strippedKeys(requiredMembershipTypes(membershipTypes), "membershipTypes",
                "import.source.membershipTypes.valueUnusable",
                "import.source.membershipTypes.valueRepeated");
    }

    // Two keys that differ only in their padding are one key once stored, and taking the last of
    // them would drop a mapping the club sent and answer as though it had been kept.
    private static <T> Map<String, T> strippedKeys(Map<String, T> entries, String field,
                                                   String unusableCode, String repeatedCode) {
        Map<String, T> stripped = new LinkedHashMap<>();
        entries.forEach((key, value) -> {
            String usable = usableEntry(key, unusableCode, field);
            if (stripped.put(usable, value) != null) {
                throw new ImportSourceInvalidException(repeatedCode,
                        Map.of("field", field, "value", usable));
            }
        });
        return stripped;
    }

    private static String usableEntry(String value, String code, String field) {
        String stripped = value == null ? "" : value.strip();
        if (stripped.isEmpty() || stripped.length() > MAX_ENTRY_LENGTH
                || stripped.codePoints().anyMatch(Character::isISOControl)) {
            throw new ImportSourceInvalidException(code,
                    Map.of("field", field, "value", ReportedValue.printable(stripped),
                            "maxLength", MAX_ENTRY_LENGTH));
        }
        return stripped;
    }

    // Only what cannot work is refused: a line break ends a record and a quote opens a cell, so
    // neither can also divide one. Which of the rest a club's system writes is the club's to say.
    private static String requiredSeparator(String separator) {
        String given = separator == null ? "" : separator;
        if (given.length() != 1 || "\n\r\"".indexOf(given.charAt(0)) >= 0
                || Character.isSurrogate(given.charAt(0))) {
            throw new ImportSourceInvalidException("import.source.separatorUnusable",
                    Map.of("separator", ReportedValue.printable(given)));
        }
        return given;
    }

    // Resolving proves the platform has it; the canonical name is stored so a club's alias and
    // the name the instance reports are never two different-looking answers to one question.
    private static String requiredEncoding(String encoding) {
        return SupportedEncodings.resolve(encoding).name();
    }

    private static SourceConfiguration toConfiguration(ImportSource source) {
        return new SourceConfiguration(source.getId(), source.getSourceKey(),
                source.getDisplayName(), source.getSeparator().charAt(0), source.getEncoding(),
                Map.copyOf(source.getColumns()),
                Map.copyOf(source.getMembershipTypes()), source.getDefaultMembershipTypeId(),
                new HashSet<>(source.getOwnedFields()), source.getRemovalWarningPercent());
    }
}
