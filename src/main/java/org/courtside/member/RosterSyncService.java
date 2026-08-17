package org.courtside.member;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.identity.AccountSessions;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.internal.PersonNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class RosterSyncService {

    private final PersonRepository persons;
    private final UserAccountRepository accounts;
    private final RosterService roster;
    private final AccountSessions sessions;

    @Transactional
    public RosterSyncOutcome apply(RosterChangeSet changeSet) {
        RosterChangeSet requested = requiredChangeSet(changeSet);
        Map<String, UUID> created = new HashMap<>();
        requested.creations().forEach(creation -> created.put(creation.externalId(), create(creation)));
        // Two runs touching the same person lock its row in the same order, so they queue
        // rather than deadlock.
        requested.corrections().stream()
                .sorted(Comparator.comparing(RosterChangeSet.PersonCorrection::personId))
                .forEach(this::correct);
        Departures departures = endMemberships(requested.membershipEndings().stream()
                .sorted().toList());
        log.info("Applied a roster snapshot: {} created, {} corrected, {} memberships ended, "
                        + "{} accounts disabled, {} accounts lost the member role",
                created.size(), requested.corrections().size(), requested.membershipEndings().size(),
                departures.disabled(), departures.rolesRemoved());
        return new RosterSyncOutcome(created, created.size(), requested.corrections().size(),
                requested.membershipEndings().size(), departures.disabled(),
                departures.rolesRemoved());
    }

    private UUID create(RosterChangeSet.NewPerson creation) {
        UUID personId = roster.createPerson(creation.firstName(), creation.lastName(),
                creation.email()).personId();
        roster.writeMembership(personId, creation.membershipTypeId(), MembershipPeriod.running());
        return personId;
    }

    private void correct(RosterChangeSet.PersonCorrection correction) {
        Person person = persons.findById(correction.personId())
                .orElseThrow(() -> new PersonNotFoundException(
                        "No person with id " + correction.personId()));
        if (correction.firstName() != null || correction.lastName() != null
                || correction.email() != null) {
            roster.changePerson(person.getId(),
                    correction.firstName() == null ? person.getFirstName() : correction.firstName(),
                    correction.lastName() == null ? person.getLastName() : correction.lastName(),
                    correction.email() == null ? person.getEmail() : correction.email());
        }
        if (correction.membershipTypeId() != null) {
            roster.writeMembership(person.getId(), correction.membershipTypeId(),
                    MembershipPeriod.running());
        }
    }

    private Departures endMemberships(List<UUID> personIds) {
        int disabled = 0;
        int rolesRemoved = 0;
        for (UUID personId : personIds) {
            roster.endMembership(personId);
            for (UserAccount account : accounts.findByPersonIdIn(List.of(personId))) {
                Departure departure = withdrawMembershipFrom(account);
                disabled += departure == Departure.DISABLED ? 1 : 0;
                rolesRemoved += departure == Departure.ROLE_REMOVED ? 1 : 0;
            }
        }
        return new Departures(disabled, rolesRemoved);
    }

    // A synchronisation never enables an account: a board disabled it for a reason no membership
    // system knows about, and no snapshot is evidence against that reason.
    private Departure withdrawMembershipFrom(UserAccount account) {
        if (!account.getRoles().contains(Role.MEMBER)) {
            return Departure.NOTHING;
        }
        Set<Role> remaining = EnumSet.copyOf(account.getRoles());
        remaining.remove(Role.MEMBER);
        long epoch = account.getSecurityEpoch();
        if (remaining.isEmpty()) {
            if (!account.isEnabled()) {
                return Departure.NOTHING;
            }
            account.disable();
            sessions.endIfRevoked(account, account.getUsername(), epoch);
            return Departure.DISABLED;
        }
        account.changeRoles(remaining);
        sessions.endIfRevoked(account, account.getUsername(), epoch);
        return Departure.ROLE_REMOVED;
    }

    private static RosterChangeSet requiredChangeSet(RosterChangeSet changeSet) {
        if (changeSet == null) {
            throw new IllegalStateException("A roster synchronisation applies a change set");
        }
        return changeSet;
    }

    private enum Departure {
        NOTHING,
        ROLE_REMOVED,
        DISABLED
    }

    private record Departures(int disabled, int rolesRemoved) {
    }
}
