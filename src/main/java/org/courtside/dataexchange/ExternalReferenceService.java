package org.courtside.dataexchange;

import lombok.RequiredArgsConstructor;
import org.courtside.dataexchange.internal.ExternalReference;
import org.courtside.dataexchange.internal.ExternalReferenceRepository;
import org.courtside.dataexchange.internal.MemberNumber;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.shared.CursorPage;
import org.courtside.shared.SqlConstraintViolation;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.Optional;
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
    private final ApplicationEventPublisher events;
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

    @Transactional
    public ExternalLink link(UUID sourceId, String externalId, UUID personId) {
        UUID source = requireKnownSource(sourceId);
        MemberNumber reference = new MemberNumber(externalId);
        UUID person = requiredPersonId(personId);
        ExternalReference existing = references.findBySourceIdAndExternalId(source, reference.value())
                .orElse(null);
        if (existing != null && existing.getPersonId().equals(person)) {
            return toLink(existing);
        }
        ExternalLink linked = toLink(saveOrTranslateCollision(
                new ExternalReference(source, reference, person, clock.instant()), reference.value()));
        events.publishEvent(
                new DataExchangeEvent.ExternalReferenceLinked(person, source, reference.value()));
        return linked;
    }

    @Transactional
    public void unlink(UUID sourceId, String externalId) {
        UUID source = requireKnownSource(sourceId);
        ExternalReference held = heldReference(source, externalId)
                .orElseThrow(() -> new ExternalReferenceNotFoundException(
                        "No such reference from import source " + source));
        references.delete(held);
        events.publishEvent(new DataExchangeEvent.ExternalReferenceUnlinked(
                held.getPersonId(), source, held.getExternalId()));
    }

    // A member number no reference can hold reaches this from a path segment, where no validation
    // precedes it, so it is answered as the absence it describes rather than as a broken request.
    private Optional<ExternalReference> heldReference(UUID sourceId, String externalId) {
        return MemberNumber.isUsable(externalId)
                ? references.findBySourceIdAndExternalId(sourceId, new MemberNumber(externalId).value())
                : Optional.empty();
    }

    private ExternalReference saveOrTranslateCollision(ExternalReference reference, String externalId) {
        try {
            return references.saveAndFlush(reference);
        } catch (DataIntegrityViolationException e) {
            if (SqlConstraintViolation.matches(
                    e, SqlConstraintViolation.UNIQUE_VIOLATION, UNIQUE_EXTERNAL_ID_CONSTRAINT)) {
                throw new ExternalIdTakenException(
                        "Member number '" + externalId + "' already names another person", e);
            }
            if (SqlConstraintViolation.matches(
                    e, SqlConstraintViolation.UNIQUE_VIOLATION, UNIQUE_PERSON_CONSTRAINT)) {
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

    private List<ExternalLink> load(List<UUID> ids) {
        List<ExternalReference> found = references.findAllById(ids);
        Map<UUID, String> names = namesOf(found.stream().map(ExternalReference::getPersonId).toList());
        return found.stream().map(reference -> toLink(reference, names)).toList();
    }

    // A reference names a row; a board reads names. Resolving here keeps the list one query per
    // page rather than one per row.
    private Map<UUID, String> namesOf(List<UUID> personIds) {
        return persons.findAllById(personIds).stream()
                .collect(Collectors.toMap(Person::getId, Person::getDisplayName));
    }

    private static UUID idOf(ExternalLink link) {
        return link.referenceId();
    }

    private ExternalLink toLink(ExternalReference reference) {
        return toLink(reference, namesOf(List.of(reference.getPersonId())));
    }

    private static ExternalLink toLink(ExternalReference reference, Map<UUID, String> names) {
        return new ExternalLink(reference.getId(), reference.getSourceId(), reference.getExternalId(),
                reference.getPersonId(), names.get(reference.getPersonId()), reference.getLinkedAt());
    }
}
