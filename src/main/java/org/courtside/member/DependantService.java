package org.courtside.member;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubTimeZone;
import org.courtside.identity.AccountCredentials;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.RecentAuthentication;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.member.internal.GuardianActionNotGrantedException;
import org.courtside.member.internal.GuardianRelationship;
import org.courtside.member.internal.GuardianRelationshipRepository;
import org.courtside.shared.SecurityEventLog;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/** What a signed-in guardian sees of their dependants and the account tasks they may take for them. */
@Service
@RequiredArgsConstructor
public class DependantService {

    private final CurrentUser currentUser;
    private final GuardianRelationships relationships;
    private final GuardianRelationshipRepository relationshipRows;
    private final GuardianDelegation delegation;
    private final PersonRepository people;
    private final AccountCredentials credentials;
    private final RecentAuthentication recentAuthentication;
    private final SecurityEventLog securityEvents;
    private final ApplicationEventPublisher events;
    private final ClubTimeZone clubTimeZone;
    private final Clock clock;

    public record Dependant(UUID personId, String firstName, String lastName, Set<GuardianGrant> grants,
                            LocalDate endedOn) {
    }

    @Transactional(readOnly = true)
    public List<Dependant> dependantsOfCurrentAccount() {
        UserAccount guardian = currentUser.requireAccount();
        if (guardian.getPerson() == null) {
            return List.of();
        }
        UUID guardianPersonId = guardian.getPerson().getId();
        LocalDate today = LocalDate.ofInstant(clock.instant(), clubTimeZone.zoneId());
        List<GuardianRelationship> running = relationshipRows.findByGuardianPersonId(guardianPersonId).stream()
                .filter(relationship -> relationship.isValidOn(today))
                .filter(relationship -> relationships.grantsFor(guardianPersonId,
                        relationship.getDependantPersonId(), today).isPresent())
                .toList();
        Map<UUID, Person> named = people.findAllById(running.stream()
                        .map(GuardianRelationship::getDependantPersonId).toList()).stream()
                .collect(Collectors.toMap(Person::getId, Function.identity()));
        return running.stream()
                .map(relationship -> {
                    Person person = named.get(relationship.getDependantPersonId());
                    return new Dependant(person.getId(), person.getFirstName(), person.getLastName(),
                            Set.copyOf(relationship.getGrants()), relationship.getEndedOn());
                })
                .sorted(Comparator.comparing(Dependant::lastName).thenComparing(Dependant::firstName)
                        .thenComparing(Dependant::personId))
                .toList();
    }

    @Transactional
    public void requestCredentials(UUID dependantPersonId) {
        GuardianDelegation.Delegation granted = delegation.require(dependantPersonId, GuardianGrant.ACCOUNT_TASKS);
        UserAccount dependant = granted.dependant();
        if (dependant.getRoles().contains(Role.ADMIN)) {
            securityEvents.authorizationDenied(granted.guardian().getId());
            throw new GuardianActionNotGrantedException("guardianship.administratorCredentials",
                    GuardianGrant.ACCOUNT_TASKS);
        }
        recentAuthentication.requireRecent();
        credentials.issueTo(dependant.getId());
        events.publishEvent(new RosterEvent.AccountCredentialsRequested(dependantPersonId, dependant.getId()));
    }
}
