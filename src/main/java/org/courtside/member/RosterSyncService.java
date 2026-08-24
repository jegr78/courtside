package org.courtside.member;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.AccountSessions;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.internal.PersonNotFoundException;
import org.courtside.member.internal.UsernameFromName;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
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
    private final ClubIdentity club;
    private final ApplicationEventPublisher events;

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
        int accountsCreated = createAccounts(requested, created);
        log.info("Applied a roster snapshot: {} created, {} corrected, {} memberships ended, "
                        + "{} accounts created, {} accounts disabled, {} accounts lost the member role",
                created.size(), requested.corrections().size(), requested.membershipEndings().size(),
                accountsCreated, departures.disabled(), departures.rolesRemoved());
        return new RosterSyncOutcome(created, created.size(), requested.corrections().size(),
                requested.membershipEndings().size(), accountsCreated, departures.disabled(),
                departures.rolesRemoved());
    }

    private int createAccounts(RosterChangeSet changeSet, Map<String, UUID> created) {
        List<AccountToCreate> wanted = new ArrayList<>();
        changeSet.creations().stream().filter(RosterChangeSet.NewPerson::withAccount)
                .forEach(creation -> wanted.add(new AccountToCreate(
                        created.get(creation.externalId()), creation.externalId())));
        changeSet.corrections().stream().filter(RosterChangeSet.PersonCorrection::withAccount)
                .forEach(correction -> wanted.add(new AccountToCreate(
                        correction.personId(), correction.externalId())));
        Set<String> issued = new HashSet<>();
        wanted.stream().sorted(Comparator.comparing(AccountToCreate::personId)).forEach(account -> {
            Person person = persons.findById(account.personId())
                    .orElseThrow(() -> new PersonNotFoundException(
                            "No person with id " + account.personId()));
            String username = unusedUsername(UsernameFromName.suggestFor(person.getFirstName(),
                    person.getLastName(), account.externalId(),
                    Locale.forLanguageTag(club.defaultLocale())), issued);
            roster.createAccount(account.personId(), username, Set.of(Role.MEMBER));
            issued.add(username);
        });
        return wanted.size();
    }

    // Both halves are needed: the query cannot see a username this same run has just handed out,
    // and the run-local set cannot see the accounts a board created by hand.
    private String unusedUsername(String suggestion, Set<String> issued) {
        String username = suggestion;
        for (int number = 2; issued.contains(username) || accounts.existsByUsername(username); number++) {
            username = suggestion + "." + number;
        }
        return username;
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
            events.publishEvent(new RosterEvent.AccountAvailabilityChanged(
                    account.getPerson().getId(), account.getId(), false));
            return Departure.DISABLED;
        }
        account.changeRoles(remaining);
        sessions.endIfRevoked(account, account.getUsername(), epoch);
        events.publishEvent(new RosterEvent.AccountRolesChanged(
                account.getPerson().getId(), account.getId(), remaining));
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

    private record AccountToCreate(UUID personId, String externalId) {
    }
}
