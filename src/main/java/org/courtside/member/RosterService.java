package org.courtside.member;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubTimeZone;
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

import java.time.Clock;
import java.time.LocalDate;
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
    private final Clock clock;
    private final ClubTimeZone clubTimeZone;

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
    public RosterEntry writeMembership(UUID personId, UUID membershipTypeId,
                                       MembershipPeriod period) {
        UUID id = requiredPersonId(personId);
        MembershipPeriod requested = requiredPeriod(period);
        requireLockedPerson(id);
        Member existing = members.findByPersonId(id).orElse(null);
        UUID typeId = assignableTypeIdFor(existing, membershipTypeId);
        if (applyMembership(id, existing, typeId, requested)) {
            revokeSessionsOf(id);
        }
        return load(List.of(id)).getFirst();
    }

    @Transactional
    public void endMembership(UUID personId) {
        UUID id = requiredPersonId(personId);
        requireLockedPerson(id);
        members.findCurrentByPersonId(id).ifPresent(member -> {
            member.endOn(today());
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

    private UUID assignableTypeIdFor(Member existing, UUID requested) {
        if (existing != null && existing.getMembershipTypeId().equals(requested)) {
            return memberships.requireMembershipType(requested).getId();
        }
        return memberships.requireAssignableMembershipType(requested).getId();
    }

    private boolean applyMembership(UUID personId, Member existing, UUID typeId,
                                   MembershipPeriod period) {
        LocalDate endedOn = period.endedOn();
        if (existing == null) {
            Member created = new Member(personId, typeId, startOr(period, today()));
            created.endOn(endedOn);
            members.saveAndFlush(created);
            return period.isRunning();
        }
        boolean wasCurrent = existing.isCurrent();
        boolean typeChanged = !existing.getMembershipTypeId().equals(typeId);
        if (wasCurrent) {
            existing.assignTo(typeId);
            existing.correctPeriod(startOr(period, existing.getStartedOn()), endedOn);
        } else {
            existing.reviveOn(typeId, startOr(period, today()));
            existing.endOn(endedOn);
        }
        members.flush();
        return typeChanged || wasCurrent != period.isRunning();
    }

    private static LocalDate startOr(MembershipPeriod period, LocalDate fallback) {
        return period.startedOn() == null ? fallback : period.startedOn();
    }

    private static MembershipPeriod requiredPeriod(MembershipPeriod period) {
        if (period == null) {
            throw new IllegalStateException("A membership must be written with a period");
        }
        return period;
    }

    private LocalDate today() {
        return LocalDate.now(clock.withZone(clubTimeZone.zoneId()));
    }

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
                        "The username requested for account " + account.getId() + " is already taken");
            }
            throw e;
        }
    }

    private static boolean isUsernameTaken(DataIntegrityViolationException e) {
        String message = e.getMostSpecificCause().getMessage();
        return message != null && message.contains(UNIQUE_USERNAME_CONSTRAINT);
    }

    private UserAccount requireAccount(UUID personId) {
        if (!persons.existsById(personId)) {
            throw new PersonNotFoundException("No person with id " + personId);
        }
        return accounts.findByPersonIdIn(List.of(personId)).stream()
                .reduce(RosterService::preferredAccount)
                .orElseThrow(() -> new AccountNotFoundException(
                        "No account for person " + personId));
    }

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
        Map<UUID, Member> membershipsByPerson = members.findByPersonIdIn(personIds).stream()
                .collect(Collectors.toMap(Member::getPersonId, member -> member));
        return persons.findAllById(personIds).stream()
                .map(person -> toEntry(person, accountsByPerson.get(person.getId()),
                        membershipsByPerson.get(person.getId())))
                .toList();
    }

    private static UserAccount preferredAccount(UserAccount first, UserAccount second) {
        return ACCOUNT_PRECEDENCE.compare(first, second) <= 0 ? first : second;
    }

    private static RosterEntry toEntry(Person person, UserAccount account, Member membership) {
        UUID membershipTypeId = membership == null ? null : membership.getMembershipTypeId();
        LocalDate startedOn = membership == null ? null : membership.getStartedOn();
        LocalDate endedOn = membership == null ? null : membership.getEndedOn();
        if (account == null) {
            return new RosterEntry(person.getId(), person.getFirstName(), person.getLastName(),
                    person.getEmail(), null, null, false, membershipTypeId, startedOn, endedOn,
                    Set.of());
        }
        return new RosterEntry(person.getId(), person.getFirstName(), person.getLastName(),
                person.getEmail(), account.getId(), account.getUsername(), account.isEnabled(),
                membershipTypeId, startedOn, endedOn, account.getRoles());
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
                              UUID membershipTypeId, LocalDate membershipStartedOn,
                              LocalDate membershipEndedOn, Set<Role> roles) {

        public RosterEntry {
            roles = Set.copyOf(roles);
        }
    }
}
