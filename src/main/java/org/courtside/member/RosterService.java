package org.courtside.member;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.AccountSessions;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.internal.AccountNotFoundException;
import org.courtside.member.internal.AdministratorLock;
import org.courtside.member.internal.LastAdministratorException;
import org.courtside.member.internal.PersonAccountExistsException;
import org.courtside.member.internal.PersonNotFoundException;
import org.courtside.member.internal.PersonText;
import org.courtside.member.internal.RosterCursorUnknownException;
import org.courtside.member.internal.UsernameTakenException;
import org.courtside.shared.CursorPage;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class RosterService {

    private static final int MAX_PAGE_SIZE = 200;
    private static final int MAX_QUERY_LENGTH = 60;
    private static final int MIN_PASSWORD_LENGTH = 12;
    private static final String UNIQUE_USERNAME_CONSTRAINT = "user_account_unique_username";

    private static final Comparator<UserAccount> ACCOUNT_PRECEDENCE =
            Comparator.comparing(UserAccount::isEnabled, Comparator.reverseOrder())
                    .thenComparing(UserAccount::getCreatedAt)
                    .thenComparing(UserAccount::getId);

    private final PersonRepository persons;
    private final UserAccountRepository accounts;
    private final MemberRepository members;
    private final MemberService memberships;
    private final AdministratorLock administrators;
    private final AccountSessions sessions;
    private final PasswordEncoder passwordEncoder;

    public CursorPage.Result<RosterEntry> list(String query, UUID cursor, int limit) {
        validateLimit(limit);
        requireKnownCursor(cursor);
        String normalized = normalize(query);
        List<UUID> ids = persons.findIdsByNameFragmentAfter(
                normalized, cursor, PageRequest.of(0, limit + 1));
        return CursorPage.of(ids, limit, this::load, RosterEntry::personId);
    }

    @Transactional
    public RosterEntry createPerson(String firstName, String lastName, String email) {
        Person person = new Person(strippedNonBlank(firstName, "first name"),
                strippedNonBlank(lastName, "last name"),
                strippedNonBlank(email, "email address"));
        return toEntry(persons.save(person), null, null);
    }

    @Transactional
    public RosterEntry changePerson(UUID personId, String firstName, String lastName, String email) {
        UUID id = requiredPersonId(personId);
        String first = strippedNonBlank(firstName, "first name");
        String last = strippedNonBlank(lastName, "last name");
        String address = strippedNonBlank(email, "email address");
        Person person = persons.findById(id)
                .orElseThrow(() -> new PersonNotFoundException("No person with id " + id));
        person.rename(first, last);
        person.changeEmail(address);
        return load(List.of(person.getId())).getFirst();
    }

    @Transactional
    public RosterEntry createAccount(UUID personId, String username, String oneTimePassword,
                                     Set<Role> roles) {
        UUID id = requiredPersonId(personId);
        String name = requiredUsername(username);
        Set<Role> requested = requiredRoles(roles);
        requireUsablePassword(oneTimePassword);
        Person person = requireLockedPerson(id);
        if (!accounts.findByPersonIdIn(List.of(id)).isEmpty()) {
            throw new PersonAccountExistsException("Person " + id + " already holds an account");
        }
        UserAccount account = new UserAccount(
                person, name, passwordEncoder.encode(oneTimePassword), requested);
        account.enable();
        account.requirePasswordChange();
        saveOrRejectTakenUsername(account);
        return load(List.of(id)).getFirst();
    }

    @Transactional
    public RosterEntry changeRoles(UUID personId, Set<Role> roles) {
        UUID id = requiredPersonId(personId);
        Set<Role> requested = requiredRoles(roles);
        UserAccount account = requireAccount(id);
        if (!requested.contains(Role.ADMIN)) {
            requireASuccessorAdministrator(account);
        }
        long epoch = account.getSecurityEpoch();
        account.changeRoles(requested);
        endStoredSessionsIfRevoked(account, account.getUsername(), epoch);
        return load(List.of(id)).getFirst();
    }

    @Transactional
    public RosterEntry changeUsername(UUID personId, String username) {
        UUID id = requiredPersonId(personId);
        String name = requiredUsername(username);
        UserAccount account = requireAccount(id);
        String previous = account.getUsername();
        long epoch = account.getSecurityEpoch();
        account.changeUsername(name);
        saveOrRejectTakenUsername(account);
        endStoredSessionsIfRevoked(account, previous, epoch);
        return load(List.of(id)).getFirst();
    }

    @Transactional
    public RosterEntry resetPassword(UUID personId, String oneTimePassword) {
        UUID id = requiredPersonId(personId);
        requireUsablePassword(oneTimePassword);
        UserAccount account = requireAccount(id);
        long epoch = account.getSecurityEpoch();
        account.resetPassword(passwordEncoder.encode(oneTimePassword));
        endStoredSessionsIfRevoked(account, account.getUsername(), epoch);
        return load(List.of(id)).getFirst();
    }

    @Transactional
    public RosterEntry setAccountEnabled(UUID personId, boolean enabled) {
        UUID id = requiredPersonId(personId);
        UserAccount account = requireAccount(id);
        if (enabled) {
            account.enable();
        } else {
            requireASuccessorAdministrator(account);
            long epoch = account.getSecurityEpoch();
            account.disable();
            endStoredSessionsIfRevoked(account, account.getUsername(), epoch);
        }
        return load(List.of(id)).getFirst();
    }

    @Transactional
    public RosterEntry assignMembership(UUID personId, UUID membershipTypeId) {
        UUID id = requiredPersonId(personId);
        requireLockedPerson(id);
        UUID typeId = memberships.requireAssignableMembershipType(membershipTypeId).getId();
        if (writeMembership(id, typeId)) {
            revokeSessionsOf(id);
        }
        return load(List.of(id)).getFirst();
    }

    @Transactional
    public void removeMembership(UUID personId) {
        UUID id = requiredPersonId(personId);
        requireLockedPerson(id);
        members.findByPersonId(id).ifPresent(member -> {
            members.delete(member);
            revokeSessionsOf(id);
        });
    }

    private void requireASuccessorAdministrator(UserAccount account) {
        if (!account.isEnabled() || !account.getRoles().contains(Role.ADMIN)) {
            return;
        }
        administrators.acquire();
        if (accounts.countEnabledHoldingRoleExcept(Role.ADMIN, account.getId()) == 0) {
            throw new LastAdministratorException("roster.lastAdministrator", Map.of());
        }
    }

    private boolean writeMembership(UUID personId, UUID membershipTypeId) {
        Member member = members.findByPersonId(personId).orElse(null);
        if (member == null) {
            members.save(new Member(personId, membershipTypeId));
            return true;
        }
        if (member.getMembershipTypeId().equals(membershipTypeId)) {
            return false;
        }
        member.assignTo(membershipTypeId);
        return true;
    }

    // Every account the person holds, not the one the roster prefers: a second one the schema
    // tolerates would otherwise keep booking under the membership it signed in with.
    private void revokeSessionsOf(UUID personId) {
        accounts.findByPersonIdIn(List.of(personId)).forEach(sessions::revoke);
    }

    private void endStoredSessionsIfRevoked(UserAccount account, String principal, long epochBefore) {
        sessions.endIfRevoked(account, principal, epochBefore);
    }

    private void saveOrRejectTakenUsername(UserAccount account) {
        try {
            accounts.saveAndFlush(account);
        } catch (DataIntegrityViolationException e) {
            if (isUsernameTaken(e)) {
                throw new UsernameTakenException(
                        "The username requested for account " + account.getId() + " is already taken", e);
            }
            throw e;
        }
    }

    private static boolean isUsernameTaken(DataIntegrityViolationException e) {
        String message = e.getMostSpecificCause().getMessage();
        return message != null && message.contains(UNIQUE_USERNAME_CONSTRAINT);
    }

    // The account the write reaches is the one the list shows, so an administrator never changes
    // a person's roles on a row the roster never displayed.
    private UserAccount requireAccount(UUID personId) {
        if (!persons.existsById(personId)) {
            throw new PersonNotFoundException("No person with id " + personId);
        }
        return accounts.findByPersonIdIn(List.of(personId)).stream()
                .reduce(RosterService::preferredAccount)
                .orElseThrow(() -> new AccountNotFoundException(
                        "No account for person " + personId));
    }

    // Locked, because the one-account check and the one-membership index both assume no second
    // write for the same person is in flight.
    private Person requireLockedPerson(UUID personId) {
        return persons.findWithLockById(personId)
                .orElseThrow(() -> new PersonNotFoundException("No person with id " + personId));
    }

    private static UUID requiredPersonId(UUID personId) {
        if (personId == null) {
            throw new IllegalStateException("A person to change must be named by an id");
        }
        return personId;
    }

    private static String requiredUsername(String username) {
        if (username == null || username.isBlank()) {
            throw new IllegalStateException("An account's username must not be blank");
        }
        return username;
    }

    private static Set<Role> requiredRoles(Set<Role> roles) {
        if (roles == null || roles.isEmpty()) {
            throw new IllegalStateException("An account must hold at least one role");
        }
        return Set.copyOf(roles);
    }

    private static void requireUsablePassword(String password) {
        if (password == null || password.length() < MIN_PASSWORD_LENGTH) {
            throw new IllegalStateException("A one-time password must contain at least "
                    + MIN_PASSWORD_LENGTH + " characters");
        }
    }

    private static String strippedNonBlank(String value, String what) {
        String stripped = value == null ? "" : PersonText.stripped(value);
        if (stripped.isEmpty()) {
            throw new IllegalStateException("A person's " + what + " must not be blank");
        }
        return stripped;
    }

    private void requireKnownCursor(UUID cursor) {
        if (cursor != null && !persons.existsById(cursor)) {
            throw new RosterCursorUnknownException("roster.cursor.unknown", Map.of());
        }
    }

    private List<RosterEntry> load(List<UUID> personIds) {
        Map<UUID, UserAccount> accountsByPerson = accounts.findByPersonIdIn(personIds).stream()
                .collect(Collectors.toMap(account -> account.getPerson().getId(), account -> account,
                        RosterService::preferredAccount));
        Map<UUID, UUID> membershipTypesByPerson = members.findByPersonIdIn(personIds).stream()
                .collect(Collectors.toMap(Member::getPersonId, Member::getMembershipTypeId));
        return persons.findAllById(personIds).stream()
                .map(person -> toEntry(person, accountsByPerson.get(person.getId()),
                        membershipTypesByPerson.get(person.getId())))
                .toList();
    }

    // user_account carries no unique person, so one person holding two must not fail a whole page.
    private static UserAccount preferredAccount(UserAccount first, UserAccount second) {
        return ACCOUNT_PRECEDENCE.compare(first, second) <= 0 ? first : second;
    }

    private static RosterEntry toEntry(Person person, UserAccount account, UUID membershipTypeId) {
        if (account == null) {
            return new RosterEntry(person.getId(), person.getFirstName(), person.getLastName(),
                    person.getEmail(), null, null, false, membershipTypeId, Set.of());
        }
        return new RosterEntry(person.getId(), person.getFirstName(), person.getLastName(),
                person.getEmail(), account.getId(), account.getUsername(), account.isEnabled(),
                membershipTypeId, account.getRoles());
    }

    private static String normalize(String query) {
        if (query == null || query.isBlank()) {
            return "";
        }
        String trimmed = query.trim();
        if (trimmed.length() > MAX_QUERY_LENGTH) {
            throw new IllegalStateException(
                    "Roster query must be at most " + MAX_QUERY_LENGTH + " characters");
        }
        return escapeLikePattern(trimmed.toLowerCase(Locale.ROOT));
    }

    private static String escapeLikePattern(String value) {
        return value.replace("!", "!!").replace("%", "!%").replace("_", "!_");
    }

    private static void validateLimit(int limit) {
        if (limit < 1 || limit > MAX_PAGE_SIZE) {
            throw new IllegalStateException("Roster page size must be between 1 and " + MAX_PAGE_SIZE);
        }
    }

    public record RosterEntry(UUID personId, String firstName, String lastName, String email,
                              UUID accountId, String username, boolean enabled,
                              UUID membershipTypeId, Set<Role> roles) {

        public RosterEntry {
            roles = Set.copyOf(roles);
        }
    }
}
