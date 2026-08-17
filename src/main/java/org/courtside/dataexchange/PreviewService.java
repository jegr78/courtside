package org.courtside.dataexchange;

import lombok.RequiredArgsConstructor;
import org.courtside.dataexchange.internal.ChangeSetResolver;
import org.courtside.dataexchange.internal.CsvSnapshot;
import org.courtside.dataexchange.internal.CurrentRoster;
import org.courtside.dataexchange.internal.ExternalReference;
import org.courtside.dataexchange.internal.ExternalReferenceRepository;
import org.courtside.dataexchange.internal.ImportPreview;
import org.courtside.dataexchange.internal.ImportPreviewRepository;
import org.courtside.dataexchange.internal.ImportProperties;
import org.courtside.dataexchange.internal.PersonFingerprint;
import org.courtside.dataexchange.internal.SnapshotParser;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.member.Member;
import org.courtside.member.MemberRepository;
import org.courtside.member.MemberService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class PreviewService {

    private final ImportPreviewRepository previews;
    private final ImportSourceService sources;
    private final ExternalReferenceRepository references;
    private final PersonRepository persons;
    private final MemberRepository members;
    private final MemberService memberships;
    private final ObjectMapper json;
    private final ImportProperties properties;
    private final Clock clock;

    @Transactional
    public PreviewSummary create(UUID sourceId, SnapshotMode mode, String fileName, byte[] content,
                                 UUID accountId) {
        SourceConfiguration configuration = sources.configurationOf(sourceId);
        SnapshotMode requested = requiredMode(mode);
        CsvSnapshot snapshot = SnapshotParser.parse(requiredContent(content), configuration.columns());
        CurrentRoster roster = currentRosterFor(sourceId, snapshot);
        ResolvedChangeSet resolved = ChangeSetResolver.resolve(snapshot, configuration, requested, roster);
        Instant now = clock.instant();
        supersedeEarlierPreviewsOf(sourceId, now);
        ImportPreview preview = previews.save(new ImportPreview(sourceId, requested,
                requiredFileName(fileName), PersonFingerprint.sha256(content), snapshot.rows().size(),
                write(new StoredContent(resolved, snapshot.ignoredColumns())),
                write(fingerprintsOf(roster)), resolved.removals().count(),
                resolved.removals().percent(), now, requiredAccountId(accountId),
                now.plus(properties.previewRetention())));
        return toSummary(preview, configuration);
    }

    public PreviewSummary read(UUID previewId) {
        ImportPreview preview = require(previewId);
        return toSummary(preview, sources.configurationOf(preview.getSourceId()));
    }

    private CurrentRoster currentRosterFor(UUID sourceId, CsvSnapshot snapshot) {
        Map<String, UUID> personIdsByExternalId = references.findBySourceId(sourceId).stream()
                .collect(Collectors.toMap(ExternalReference::getExternalId,
                        ExternalReference::getPersonId));
        List<UUID> linked = List.copyOf(personIdsByExternalId.values());
        Map<UUID, Member> membershipsByPerson = members.findByPersonIdIn(linked).stream()
                .collect(Collectors.toMap(Member::getPersonId, Function.identity()));
        Map<UUID, CurrentRoster.RosterPerson> peopleById = persons.findAllById(linked).stream()
                .collect(Collectors.toMap(Person::getId,
                        person -> toRosterPerson(person, membershipsByPerson.get(person.getId()))));
        return new CurrentRoster(personIdsByExternalId, peopleById,
                memberships.activeMembershipTypeIds(), personIdsByNameKey(snapshot));
    }

    // Only the names the file actually carries: a club with thousands of members would otherwise
    // read its whole person table on every upload to answer a question about a few hundred rows.
    private Map<String, List<UUID>> personIdsByNameKey(CsvSnapshot snapshot) {
        Set<String> wanted = snapshot.rows().stream()
                .map(row -> ChangeSetResolver.nameKeyOf(row.values()))
                .collect(Collectors.toSet());
        if (wanted.isEmpty()) {
            return Map.of();
        }
        return persons.findAll().stream()
                .filter(person -> wanted.contains(
                        ChangeSetResolver.nameKeyOf(person.getFirstName(), person.getLastName())))
                .collect(Collectors.groupingBy(
                        person -> ChangeSetResolver.nameKeyOf(person.getFirstName(), person.getLastName()),
                        Collectors.mapping(Person::getId, Collectors.toList())));
    }

    private static CurrentRoster.RosterPerson toRosterPerson(Person person, Member member) {
        return new CurrentRoster.RosterPerson(person.getId(), person.getFirstName(),
                person.getLastName(), person.getEmail(),
                member == null ? null : member.getMembershipTypeId(),
                member != null && member.isCurrent());
    }

    private static Map<String, String> fingerprintsOf(CurrentRoster roster) {
        Map<String, String> fingerprints = new HashMap<>();
        roster.peopleById().forEach((personId, person) -> fingerprints.put(personId.toString(),
                PersonFingerprint.of(person.firstName(), person.lastName(), person.email(),
                        person.membershipTypeId(), person.membershipCurrent())));
        return fingerprints;
    }

    private void supersedeEarlierPreviewsOf(UUID sourceId, Instant now) {
        previews.findBySourceIdAndSupersededAtIsNull(sourceId)
                .forEach(preview -> preview.supersedeOn(now));
    }

    private PreviewSummary toSummary(ImportPreview preview, SourceConfiguration configuration) {
        StoredContent stored = read(preview.getChangeSet());
        return new PreviewSummary(preview.getId(), preview.getSourceId(), preview.getMode(),
                preview.getFileName(), preview.getFileHash(), preview.getRowCount(),
                stored.ignoredColumns(), stored.changeSet(),
                preview.getRemovalPercent() > configuration.removalWarningPercent(),
                preview.getCreatedAt(), preview.getExpiresAt(), preview.isSuperseded());
    }

    private ImportPreview require(UUID previewId) {
        if (previewId == null) {
            throw new IllegalStateException("A preview must be named by an id");
        }
        return previews.findById(previewId).orElseThrow(() ->
                new ImportPreviewNotFoundException("No import preview with id " + previewId));
    }

    private String write(Object value) {
        return json.writeValueAsString(value);
    }

    private StoredContent read(String changeSet) {
        return changeSet == null
                ? new StoredContent(null, List.of())
                : json.readValue(changeSet, StoredContent.class);
    }

    private static SnapshotMode requiredMode(SnapshotMode mode) {
        if (mode == null) {
            throw new IllegalStateException("A snapshot is uploaded as a full snapshot or as an update");
        }
        return mode;
    }

    private static byte[] requiredContent(byte[] content) {
        if (content == null) {
            throw new IllegalStateException("A snapshot is uploaded with the file it stands for");
        }
        return content;
    }

    private static String requiredFileName(String fileName) {
        if (fileName == null || fileName.isBlank()) {
            throw new IllegalStateException("An uploaded snapshot carries the name of its file");
        }
        return fileName.strip();
    }

    private static UUID requiredAccountId(UUID accountId) {
        if (accountId == null) {
            throw new IllegalStateException("A preview records the account that took it");
        }
        return accountId;
    }

    private record StoredContent(ResolvedChangeSet changeSet, List<String> ignoredColumns) {
    }
}
