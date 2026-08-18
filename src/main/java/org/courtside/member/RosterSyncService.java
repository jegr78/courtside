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
import java.util.stream.Stream;

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
        // One order over both phases, not one per phase: two runs that correct and end opposite
        // people would otherwise take the same two rows in opposite orders and deadlock.
        lockInIdOrder(requested);
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

    private void lockInIdOrder(RosterChangeSet changeSet) {
        Stream.concat(changeSet.corrections().stream().map(RosterChangeSet.PersonCorrection::personId),
                        changeSet.membershipEndings().stream())
                .distinct()
                .sorted()
                .forEach(personId -> persons.findWithLockById(personId)
                        .orElseThrow(() -> new PersonNotFoundException("No person with id " + personId)));
    }

    private UUID create(RosterChangeSet.NewPerson creation) {
        UUID personId = roster.createPerson(creation.firstName(), creation.lastName(),
                creation.email()).personId();
        roster.writeMembership(personId, creation.membershipTypeId(), MembershipPeriod.running());
        return personId;
    }

    private void correct(RosterChangeSet.PersonCorrection correction) {
        if (correction.firstName() != null || correction.lastName() != null
                || correction.email() != null) {
            roster.correctPerson(correction.personId(), correction.firstName(),
                    correction.lastName(), correction.email());
        }
        if (correction.membershipTypeId() != null) {
            roster.writeMembership(correction.personId(), correction.membershipTypeId(),
                    MembershipPeriod.running());
        }
    }

    private Departures endMemberships(List<UUID> personIds) {
        personIds.forEach(roster::endMembership);
        int disabled = 0;
        int rolesRemoved = 0;
        for (UserAccount account : accounts.findByPersonIdIn(personIds)) {
            Departure departure = withdrawMembershipFrom(account);
            disabled += departure == Departure.DISABLED ? 1 : 0;
            rolesRemoved += departure == Departure.ROLE_REMOVED ? 1 : 0;
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
