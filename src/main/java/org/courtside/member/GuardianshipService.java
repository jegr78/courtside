package org.courtside.member;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.internal.GuardianRelationship;
import org.courtside.member.internal.GuardianRelationshipNotFoundException;
import org.courtside.member.internal.GuardianRelationshipOverlapException;
import org.courtside.member.internal.GuardianRelationshipRepository;
import org.courtside.member.internal.InvalidGuardianRelationshipException;
import org.courtside.member.internal.PersonNotFoundException;
import org.courtside.shared.SqlConstraintViolation;
import org.jspecify.annotations.Nullable;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class GuardianshipService {

    static final String DISJOINT_RELATIONSHIPS_CONSTRAINT = "guardian_relationships_disjoint";

    private final GuardianRelationshipRepository relationships;
    private final PersonRepository persons;
    private final UserAccountRepository accounts;
    private final MemberService memberships;
    private final ApplicationEventPublisher events;

    public List<Guardianship> guardianshipsOf(UUID personId) {
        UUID id = requiredId(personId, "A person must be named by an id");
        if (!persons.existsById(id)) {
            throw new PersonNotFoundException("No person with id " + id);
        }
        List<GuardianRelationship> found = relationships.findInvolving(id);
        Map<UUID, Person> people = persons.findAllById(found.stream()
                        .flatMap(relationship -> Stream.of(relationship.getGuardianPersonId(),
                                relationship.getDependantPersonId()))
                        .collect(Collectors.toSet())).stream()
                .collect(Collectors.toMap(Person::getId, Function.identity()));
        LocalDate today = memberships.today();
        return found.stream().map(relationship -> Guardianship.of(relationship, people, today)).toList();
    }

    @Transactional
    public Guardianship create(UUID personId, UUID guardianPersonId, UUID dependantPersonId,
                               Set<GuardianGrant> grants, @Nullable LocalDate endedOn) {
        UUID id = requiredId(personId, "A person must be named by an id");
        UUID guardian = requiredId(guardianPersonId, "A guardian must be named by an id");
        UUID dependant = requiredId(dependantPersonId, "A dependant must be named by an id");
        if (!id.equals(guardian) && !id.equals(dependant)) {
            throw new InvalidGuardianRelationshipException("guardianship.notAParty");
        }
        if (guardian.equals(dependant)) {
            throw new InvalidGuardianRelationshipException("guardianship.self");
        }
        Set<GuardianGrant> granted = requiredGrants(grants);
        Map<UUID, Person> people = lockPeople(guardian, dependant);
        if (accounts.findByPersonIdIn(List.of(guardian, dependant)).stream()
                .map(account -> account.getPerson().getId()).distinct().count() < 2) {
            throw new InvalidGuardianRelationshipException("guardianship.accountRequired");
        }
        LocalDate today = memberships.today();
        requireEndAfter(today, endedOn);
        GuardianRelationship created = new GuardianRelationship(guardian, dependant, today, granted, endedOn);
        requireNotReversed(created, today);
        saveOrRejectOverlap(created);
        events.publishEvent(new RosterEvent.GuardianshipCreated(dependant, created.getId(), guardian,
                Set.copyOf(granted), today, endedOn));
        return Guardianship.of(created, people, today);
    }

    @Transactional
    public Guardianship change(UUID personId, UUID relationshipId, Set<GuardianGrant> grants,
                               @Nullable LocalDate endedOn) {
        Set<GuardianGrant> granted = requiredGrants(grants);
        Locked locked = lockedRelationship(personId, relationshipId);
        GuardianRelationship existing = locked.relationship();
        Map<UUID, Person> people = locked.people();
        requireEndAfter(existing.getStartedOn(), endedOn);
        existing.change(granted, endedOn);
        LocalDate today = memberships.today();
        requireNotReversed(existing, today);
        saveOrRejectOverlap(existing);
        events.publishEvent(new RosterEvent.GuardianshipChanged(existing.getDependantPersonId(), existing.getId(),
                existing.getGuardianPersonId(), Set.copyOf(granted), endedOn));
        return Guardianship.of(existing, people, today);
    }

    @Transactional
    public Guardianship end(UUID personId, UUID relationshipId) {
        Locked locked = lockedRelationship(personId, relationshipId);
        GuardianRelationship existing = locked.relationship();
        Map<UUID, Person> people = locked.people();
        LocalDate today = memberships.today();
        if (existing.holdsAfter(today)) {
            existing.endOn(today);
            relationships.saveAndFlush(existing);
            events.publishEvent(new RosterEvent.GuardianshipEnded(existing.getDependantPersonId(), existing.getId(),
                    existing.getGuardianPersonId(), today));
        }
        return Guardianship.of(existing, people, today);
    }

    @Transactional
    public void remove(UUID personId, UUID relationshipId) {
        GuardianRelationship existing = lockedRelationship(personId, relationshipId).relationship();
        relationships.delete(existing);
        relationships.flush();
        events.publishEvent(new RosterEvent.GuardianshipRemoved(existing.getDependantPersonId(), existing.getId(),
                existing.getGuardianPersonId()));
    }

    private Locked lockedRelationship(UUID personId, UUID relationshipId) {
        UUID id = requiredId(personId, "A person must be named by an id");
        UUID relationship = requiredId(relationshipId, "A guardian relationship must be named by an id");
        GuardianRelationshipRepository.Parties parties = relationships.findPartiesInvolving(relationship, id)
                .orElseThrow(() -> notFound(relationship, id));
        Map<UUID, Person> people = lockPeople(parties.guardianPersonId(), parties.dependantPersonId());
        return new Locked(relationships.findWithLockById(relationship).orElseThrow(() -> notFound(relationship, id)),
                people);
    }

    private static GuardianRelationshipNotFoundException notFound(UUID relationshipId, UUID personId) {
        return new GuardianRelationshipNotFoundException(
                "No guardian relationship " + relationshipId + " for person " + personId);
    }

    private record Locked(GuardianRelationship relationship, Map<UUID, Person> people) {
    }

    private Map<UUID, Person> lockPeople(UUID first, UUID second) {
        return Stream.of(first, second).sorted()
                .map(id -> persons.findWithLockById(id)
                        .orElseThrow(() -> new PersonNotFoundException("No person with id " + id)))
                .collect(Collectors.toMap(Person::getId, Function.identity()));
    }

    private void requireNotReversed(GuardianRelationship relationship, LocalDate today) {
        if (!relationship.holdsAfter(today)) {
            return;
        }
        boolean reversed = relationships.findByGuardianPersonIdAndDependantPersonId(
                        relationship.getDependantPersonId(), relationship.getGuardianPersonId()).stream()
                .anyMatch(other -> other.holdsAfter(today));
        if (reversed) {
            throw new InvalidGuardianRelationshipException("guardianship.reversed");
        }
    }

    private void saveOrRejectOverlap(GuardianRelationship relationship) {
        try {
            relationships.saveAndFlush(relationship);
        } catch (DataIntegrityViolationException e) {
            if (SqlConstraintViolation.matches(e, SqlConstraintViolation.EXCLUSION_VIOLATION,
                    DISJOINT_RELATIONSHIPS_CONSTRAINT)) {
                throw new GuardianRelationshipOverlapException("guardianship.overlaps", Map.of());
            }
            throw e;
        }
    }

    private static void requireEndAfter(LocalDate start, @Nullable LocalDate endedOn) {
        if (endedOn != null && endedOn.isBefore(start)) {
            throw new InvalidGuardianRelationshipException("guardianship.endsBeforeItBegan");
        }
        if (start.equals(endedOn)) {
            throw new InvalidGuardianRelationshipException("guardianship.coversNoDay");
        }
    }

    private static Set<GuardianGrant> requiredGrants(@Nullable Set<GuardianGrant> grants) {
        if (grants == null || grants.isEmpty() || grants.stream().anyMatch(Objects::isNull)) {
            throw new InvalidGuardianRelationshipException("guardianship.grantsRequired");
        }
        return EnumSet.copyOf(grants);
    }

    private static UUID requiredId(@Nullable UUID id, String failure) {
        if (id == null) {
            throw new IllegalStateException(failure);
        }
        return id;
    }

    public record Party(UUID personId, String firstName, String lastName) {
    }

    public record Guardianship(UUID id, Party guardian, Party dependant, Set<GuardianGrant> grants,
                               LocalDate startedOn, @Nullable LocalDate endedOn, GuardianRelationshipState state) {

        static Guardianship of(GuardianRelationship relationship, Map<UUID, Person> people, LocalDate today) {
            return new Guardianship(relationship.getId(),
                    party(people.get(relationship.getGuardianPersonId())),
                    party(people.get(relationship.getDependantPersonId())),
                    Set.copyOf(relationship.getGrants()), relationship.getStartedOn(), relationship.getEndedOn(),
                    relationship.stateOn(today));
        }

        private static Party party(Person person) {
            return new Party(person.getId(), person.getFirstName(), person.getLastName());
        }
    }
}
