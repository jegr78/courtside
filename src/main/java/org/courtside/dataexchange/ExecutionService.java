package org.courtside.dataexchange;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.dataexchange.internal.ExternalReference;
import org.courtside.dataexchange.internal.ExternalReferenceRepository;
import org.courtside.dataexchange.internal.ImportPreview;
import org.courtside.dataexchange.internal.ImportPreviewRepository;
import org.courtside.dataexchange.internal.ImportRun;
import org.courtside.dataexchange.internal.ImportRunRepository;
import org.courtside.dataexchange.internal.MemberNumber;
import org.courtside.dataexchange.internal.PersonFingerprint;
import org.courtside.dataexchange.internal.PreviewContent;
import org.courtside.dataexchange.internal.SourceLock;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.member.Member;
import org.courtside.member.MemberRepository;
import org.courtside.member.RosterChangeSet;
import org.courtside.member.RosterSyncOutcome;
import org.courtside.member.RosterSyncService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ExecutionService {

    private final ImportPreviewRepository previews;
    private final ImportRunRepository runs;
    private final ExternalReferenceRepository references;
    private final ImportSourceService sources;
    private final RosterSyncService rosterSync;
    private final PersonRepository persons;
    private final MemberRepository members;
    private final SourceLock sourceLock;
    private final ObjectMapper json;
    private final Clock clock;

    @Transactional
    public RunOutcome execute(UUID previewId, boolean confirmRemovals, UUID accountId) {
        // Under the lock before anything is read from it: the checks below must see the state the
        // run will write against, not the one a competing run was about to change.
        sourceLock.acquire(require(previewId).getSourceId());
        ImportPreview preview = require(previewId);
        Instant now = clock.instant();
        requireExecutable(preview, now);
        PreviewContent content = contentOf(preview);
        requireNobodyChangedSince(preview, content);
        requireConfirmedRemovals(preview, confirmRemovals);

        RosterSyncOutcome applied = rosterSync.apply(toRosterChangeSet(content.changeSet()));
        linkCreations(preview.getSourceId(), applied.createdPersonIdsByExternalId(), now);
        supersedeEveryPreviewOf(preview.getSourceId(), now);
        preview.forget();
        ImportRun run = runs.saveAndFlush(new ImportRun(preview.getSourceId(), preview.getId(),
                preview.getMode(), preview.getFileHash(), applied.created(), applied.corrected(),
                applied.membershipsEnded(), applied.accountsDisabled(), applied.rolesRemoved(),
                content.changeSet().errors().size(), confirmRemovals, now,
                requiredAccountId(accountId)));
        log.info("Executed import run {} for source {}: {} created, {} corrected, {} ended",
                run.getId(), preview.getSourceId(), applied.created(), applied.corrected(),
                applied.membershipsEnded());
        return toOutcome(run);
    }

    public List<RunOutcome> runsOf(UUID sourceId) {
        return runs.findBySourceIdOrderByExecutedAtDesc(sources.configurationOf(sourceId).sourceId())
                .stream()
                .map(ExecutionService::toOutcome)
                .toList();
    }

    private void requireExecutable(ImportPreview preview, Instant now) {
        if (preview.isSuperseded()) {
            throw new ImportPreviewSupersededException("import.preview.superseded",
                    Map.of("previewId", preview.getId().toString()));
        }
        if (preview.hasExpiredBy(now) || preview.getChangeSet() == null) {
            throw new ImportPreviewExpiredException("import.preview.expired",
                    Map.of("previewId", preview.getId().toString()));
        }
    }

    private void requireNobodyChangedSince(ImportPreview preview, PreviewContent content) {
        Map<String, String> taken = fingerprintsTakenWith(preview);
        List<UUID> affected = affectedPersonIdsOf(content);
        Map<UUID, String> now = fingerprintsOf(affected);
        TreeSet<String> changed = new TreeSet<>();
        affected.forEach(personId -> {
            String before = taken.get(personId.toString());
            String current = now.get(personId);
            if (current == null || before == null || !before.equals(current)) {
                changed.add(personId.toString());
            }
        });
        if (!changed.isEmpty()) {
            throw new ImportPreviewStaleException("import.preview.stale",
                    Map.of("personIds", List.copyOf(changed)));
        }
        requireEveryCreationStillUnclaimed(preview, content);
    }

    // A creation carries no person id, so the fingerprint check above cannot see it; what changes
    // under it is the reference somebody linked while the preview sat waiting.
    private void requireEveryCreationStillUnclaimed(ImportPreview preview, PreviewContent content) {
        Set<String> creations = content.changeSet().changes().stream()
                .filter(change -> change.kind() == ResolvedChangeSet.ChangeKind.CREATE)
                .map(ResolvedChangeSet.PersonChange::externalId)
                .collect(Collectors.toSet());
        if (creations.isEmpty()) {
            return;
        }
        TreeSet<String> claimed = references
                .findBySourceIdAndExternalIdIn(preview.getSourceId(), creations).stream()
                .map(ExternalReference::getExternalId)
                .collect(Collectors.toCollection(TreeSet::new));
        if (!claimed.isEmpty()) {
            throw new ImportPreviewStaleException("import.preview.externalIdClaimed",
                    Map.of("externalIds", List.copyOf(claimed)));
        }
    }

    // The threshold the preview was judged against, not today's: what a board reviewed is what it
    // is asked to confirm.
    private void requireConfirmedRemovals(ImportPreview preview, boolean confirmRemovals) {
        if (preview.needsConfirmation() && !confirmRemovals) {
            throw new RemovalsNeedConfirmationException("import.removals.needConfirmation",
                    Map.of("count", preview.getRemovalCount(),
                            "percent", preview.getRemovalPercent(),
                            "threshold", preview.getRemovalWarningPercent()));
        }
    }

    private static List<UUID> affectedPersonIdsOf(PreviewContent content) {
        return content.changeSet().changes().stream()
                .map(ResolvedChangeSet.PersonChange::personId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
    }

    private Map<UUID, String> fingerprintsOf(List<UUID> personIds) {
        Map<UUID, Member> membershipsByPerson = members.findByPersonIdIn(personIds).stream()
                .collect(Collectors.toMap(Member::getPersonId, Function.identity()));
        Map<UUID, String> fingerprints = new HashMap<>();
        persons.findAllById(personIds).forEach(person -> {
            Member member = membershipsByPerson.get(person.getId());
            fingerprints.put(person.getId(), PersonFingerprint.of(person.getFirstName(),
                    person.getLastName(), person.getEmail(),
                    member == null ? null : member.getMembershipTypeId(),
                    member != null && member.isCurrent()));
        });
        return fingerprints;
    }

    private Map<String, String> fingerprintsTakenWith(ImportPreview preview) {
        return preview.getFingerprints() == null
                ? Map.of()
                : json.readValue(preview.getFingerprints(), new TypeReference<>() { });
    }

    private static RosterChangeSet toRosterChangeSet(ResolvedChangeSet changeSet) {
        List<RosterChangeSet.NewPerson> creations = new ArrayList<>();
        List<RosterChangeSet.PersonCorrection> corrections = new ArrayList<>();
        List<UUID> endings = new ArrayList<>();
        changeSet.changes().forEach(change -> {
            switch (change.kind()) {
                case CREATE -> creations.add(new RosterChangeSet.NewPerson(change.externalId(),
                        change.values().get(CanonicalField.FIRST_NAME),
                        change.values().get(CanonicalField.LAST_NAME),
                        change.values().get(CanonicalField.EMAIL),
                        change.membershipTypeId()));
                case UPDATE -> corrections.add(new RosterChangeSet.PersonCorrection(
                        change.personId(), change.values().get(CanonicalField.FIRST_NAME),
                        change.values().get(CanonicalField.LAST_NAME),
                        change.values().get(CanonicalField.EMAIL), change.membershipTypeId()));
                case END_MEMBERSHIP -> endings.add(change.personId());
            }
        });
        return new RosterChangeSet(creations, corrections, endings);
    }

    private void linkCreations(UUID sourceId, Map<String, UUID> createdByExternalId, Instant now) {
        createdByExternalId.forEach((externalId, personId) ->
                references.save(new ExternalReference(sourceId, new MemberNumber(externalId), personId, now)));
        references.flush();
    }

    private void supersedeEveryPreviewOf(UUID sourceId, Instant now) {
        previews.findBySourceIdAndSupersededAtIsNull(sourceId)
                .forEach(preview -> preview.supersedeOn(now));
    }

    private PreviewContent contentOf(ImportPreview preview) {
        return json.readValue(preview.getChangeSet(), PreviewContent.class);
    }

    private ImportPreview require(UUID previewId) {
        if (previewId == null) {
            throw new IllegalStateException("An execution names the preview it applies");
        }
        return previews.findById(previewId).orElseThrow(() ->
                new ImportPreviewNotFoundException("No import preview with id " + previewId));
    }

    private static UUID requiredAccountId(UUID accountId) {
        if (accountId == null) {
            throw new IllegalStateException("A run records the account that executed it");
        }
        return accountId;
    }

    private static RunOutcome toOutcome(ImportRun run) {
        return new RunOutcome(run.getId(), run.getSourceId(), run.getPreviewId(), run.getMode(),
                run.getFileHash(), run.getCreatedCount(), run.getCorrectedCount(),
                run.getEndedCount(), run.getAccountsDisabledCount(), run.getRolesRemovedCount(),
                run.getRowErrorCount(), run.isRemovalsConfirmed(), run.getExecutedAt());
    }
}
