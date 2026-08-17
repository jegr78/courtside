package org.courtside.dataexchange;

import lombok.RequiredArgsConstructor;
import org.courtside.dataexchange.internal.ExternalReference;
import org.courtside.dataexchange.internal.ExternalReferenceRepository;
import org.courtside.identity.PersonRepository;
import org.courtside.shared.CursorPage;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ExternalReferenceService {

    private static final int MAX_PAGE_SIZE = 200;
    private static final String UNIQUE_EXTERNAL_ID_CONSTRAINT =
            "import_external_reference_unique_external_id";
    private static final String UNIQUE_PERSON_CONSTRAINT = "import_external_reference_unique_person";

    private final ExternalReferenceRepository references;
    private final ImportSourceService sources;
    private final PersonRepository persons;
    private final Clock clock;

    public CursorPage.Result<ExternalLink> list(UUID sourceId, UUID cursor, int limit) {
        if (limit < 1 || limit > MAX_PAGE_SIZE) {
            throw new IllegalStateException("A reference page holds between 1 and " + MAX_PAGE_SIZE);
        }
        UUID source = requireKnownSource(sourceId);
        requireKnownCursor(source, cursor);
        List<UUID> ids = references.findIdsBySourceIdAfter(source, cursor, PageRequest.of(0, limit + 1));
        return CursorPage.of(ids, limit, this::load, ExternalReferenceService::idOf);
    }

    public Map<String, UUID> personIdsByExternalId(UUID sourceId, Set<String> externalIds) {
        if (externalIds == null || externalIds.isEmpty()) {
            return Map.of();
        }
        return references.findBySourceIdAndExternalIdIn(requireKnownSource(sourceId), externalIds).stream()
                .collect(Collectors.toMap(ExternalReference::getExternalId, ExternalReference::getPersonId));
    }

    @Transactional
    public ExternalLink link(UUID sourceId, String externalId, UUID personId) {
        UUID source = requireKnownSource(sourceId);
        String reference = requiredExternalId(externalId);
        UUID person = requiredPersonId(personId);
        ExternalReference existing = references.findBySourceIdAndExternalId(source, reference).orElse(null);
        if (existing != null && existing.getPersonId().equals(person)) {
            return toLink(existing);
        }
        return toLink(saveOrTranslateCollision(
                new ExternalReference(source, reference, person, clock.instant()), reference));
    }

    @Transactional
    public void unlink(UUID sourceId, String externalId) {
        UUID source = requireKnownSource(sourceId);
        String reference = requiredExternalId(externalId);
        references.delete(references.findBySourceIdAndExternalId(source, reference)
                .orElseThrow(() -> new ExternalReferenceNotFoundException(
                        "No reference '" + reference + "' from import source " + source)));
    }

    private ExternalReference saveOrTranslateCollision(ExternalReference reference, String externalId) {
        try {
            return references.saveAndFlush(reference);
        } catch (DataIntegrityViolationException e) {
            String message = e.getMostSpecificCause().getMessage();
            if (message == null) {
                throw e;
            }
            if (message.contains(UNIQUE_EXTERNAL_ID_CONSTRAINT)) {
                throw new ExternalIdTakenException(
                        "Member number '" + externalId + "' already names another person", e);
            }
            if (message.contains(UNIQUE_PERSON_CONSTRAINT)) {
                throw new PersonAlreadyLinkedException(
                        "This person already holds a reference from import source "
                                + reference.getSourceId(), e);
            }
            throw e;
        }
    }

    private UUID requireKnownSource(UUID sourceId) {
        return sources.configurationOf(sourceId).sourceId();
    }

    private void requireKnownCursor(UUID sourceId, UUID cursor) {
        if (cursor != null && references.findById(cursor)
                .filter(reference -> reference.getSourceId().equals(sourceId)).isEmpty()) {
            throw new ExternalReferenceNotFoundException(
                    "No reference " + cursor + " to page after in import source " + sourceId);
        }
    }

    private UUID requiredPersonId(UUID personId) {
        if (personId == null) {
            throw new IllegalStateException("A reference names the person it links to");
        }
        if (!persons.existsById(personId)) {
            throw new LinkedPersonNotFoundException("No person with id " + personId);
        }
        return personId;
    }

    private static String requiredExternalId(String externalId) {
        if (externalId == null || externalId.isBlank()) {
            throw new IllegalStateException("A reference names the member number it stands for");
        }
        return externalId.strip();
    }

    private List<ExternalLink> load(List<UUID> ids) {
        return references.findAllById(ids).stream().map(ExternalReferenceService::toLink).toList();
    }

    private static UUID idOf(ExternalLink link) {
        return link.referenceId();
    }

    private static ExternalLink toLink(ExternalReference reference) {
        return new ExternalLink(reference.getId(), reference.getSourceId(), reference.getExternalId(),
                reference.getPersonId(), reference.getLinkedAt());
    }
}
