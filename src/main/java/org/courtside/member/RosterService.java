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
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.LinkedHashSet;
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
    private final ApplicationEventPublisher events;

    public CursorPage.Result<RosterEntry> list(String query, UUID membershipTypeId, UUID cursor, int limit) {
        validateLimit(limit);
        requireKnownCursor(cursor);
        List<UUID> holders = membershipTypeId == null
                ? List.of()
                : members.findCurrentHolderIds(membershipTypeId);
        if (membershipTypeId != null && holders.isEmpty()) {
            return new CursorPage.Result<>(List.of(), null);
        }
        List<UUID> ids = persons.findIdsByNameFragmentAfter(
                normalize(query), membershipTypeId != null, holders, cursor, PageRequest.of(0, limit + 1));
        return CursorPage.of(ids, limit, this::load, RosterEntry::personId);
    }

    public RosterEntry person(UUID personId) {
        UUID id = requiredPersonId(personId);
        return load(List.of(id)).stream().findFirst()
                .orElseThrow(() -> new PersonNotFoundException("No person with id " + id));
    }

    @Transactional
    public RosterEntry createPerson(String firstName, String lastName, String email) {
        Person person = new Person(strippedNonBlank(firstName, "first name"),
                strippedNonBlank(lastName, "last name"),
                strippedAddress(email));
        Person saved = persons.save(person);
        events.publishEvent(new RosterEvent.PersonAdded(saved.getId()));
        return toEntry(saved, null, null);
    }

    @Transactional
    public RosterEntry changePerson(UUID personId, String firstName, String lastName, String email) {
        UUID id = requiredPersonId(personId);
        String first = strippedNonBlank(firstName, "first name");
        String last = strippedNonBlank(lastName, "last name");
        String address = strippedAddress(email);
        Person person = persons.findById(id)
                .orElseThrow(() -> new PersonNotFoundException("No person with id " + id));
        requireAddressWhereAnAccountNeedsOne(id, address);
        Set<String> changed = changedFields(person, first, last, address);
        person.rename(first, last);
        person.changeEmail(address);
        if (!changed.isEmpty()) {
            events.publishEvent(new RosterEvent.PersonCorrected(person.getId(), changed));
        }
        return load(List.of(person.getId())).getFirst();
    }

    // Only what the caller carries is checked: a synchronisation must not fail on a stored value
    // it is not touching, or one bad address would stop every later run of that source.
    @Transactional
    public void correctPerson(UUID personId, String firstName, String lastName, String email) {
        UUID id = requiredPersonId(personId);
        Person person = persons.findById(id)
                .orElseThrow(() -> new PersonNotFoundException("No person with id " + id));
        Set<String> corrected = correctedFields(person, firstName, lastName, email);
        if (firstName != null || lastName != null) {
            person.rename(
                    firstName == null ? person.getFirstName() : strippedNonBlank(firstName, "first name"),
                    lastName == null ? person.getLastName() : strippedNonBlank(lastName, "last name"));
        }
        if (email != null) {
            person.changeEmail(strippedAddress(email));
        }
        if (!corrected.isEmpty()) {
            events.publishEvent(new RosterEvent.PersonCorrected(id, corrected));
        }
    }

    @Transactional
    public RosterEntry createAccount(UUID personId, String username, String oneTimePassword,
                                     Set<Role> roles) {
        UUID id = requiredPersonId(personId);
        String name = requiredUsername(username);
        Set<Role> requested = requiredRoles(roles);
        requireUsablePassword(oneTimePassword);
        Person person = requireLockedPerson(id);
        if (person.getEmail().isEmpty()) {
            throw new AccountAddressRequiredException("roster.account.addressMissing", Map.of());
        }
        if (!accounts.findByPersonIdIn(List.of(id)).isEmpty()) {
            throw new PersonAccountExistsException("Person " + id + " already holds an account");
        }
        UserAccount account = new UserAccount(
                person, name, passwordEncoder.encode(oneTimePassword), requested);
        account.enable();
        account.requirePasswordChange();
        saveOrRejectTakenUsername(account);
        events.publishEvent(new RosterEvent.AccountCreated(id, account.getId(), requested));
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
        events.publishEvent(new RosterEvent.AccountRolesChanged(id, account.getId(), requested));
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
        events.publishEvent(new RosterEvent.AccountUsernameCorrected(id, account.getId()));
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
        events.publishEvent(new RosterEvent.AccountPasswordReset(id, account.getId()));
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
        events.publishEvent(new RosterEvent.AccountAvailabilityChanged(id, account.getId(), enabled));
        return load(List.of(id)).getFirst();
    }

    @Transactional
    public RosterEntry writeMembership(UUID personId, UUID membershipTypeId,
                                       MembershipPeriod period) {
        UUID id = requiredPersonId(personId);
        MembershipPeriod requested = requiredPeriod(period).requireNotInTheFuture(today());
        requireLockedPerson(id);
        Member existing = members.findByPersonId(id).orElse(null);
        UUID typeId = assignableTypeIdFor(existing, membershipTypeId, requested);
        if (applyMembership(id, existing, typeId, requested)) {
            revokeSessionsOf(id);
        }
        events.publishEvent(new RosterEvent.MembershipWritten(
                id, typeId, requested.startedOn(), requested.endedOn()));
        return load(List.of(id)).getFirst();
    }

    @Transactional
    public void endMembership(UUID personId) {
        UUID id = requiredPersonId(personId);
        requireLockedPerson(id);
        members.findCurrentByPersonId(id).ifPresent(member -> {
            member.endOn(today());
            revokeSessionsOf(id);
            events.publishEvent(new RosterEvent.MembershipEnded(id));
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

    private UUID assignableTypeIdFor(Member existing, UUID requested, MembershipPeriod period) {
        if (makesSomebodyAMemberOfANewType(existing, requested, period)) {
            return memberships.requireAssignableMembershipType(requested).getId();
        }
        return memberships.requireMembershipType(requested).getId();
    }

    private static boolean makesSomebodyAMemberOfANewType(Member existing, UUID requested,
                                                          MembershipPeriod period) {
        return period.isCurrent()
                && (existing == null
                || !existing.isCurrent()
                || !existing.getMembershipTypeId().equals(requested));
    }

    private boolean applyMembership(UUID personId, Member existing, UUID typeId,
                                   MembershipPeriod period) {
        LocalDate endedOn = period.endedOn();
        if (existing == null) {
            Member created = new Member(personId, typeId, startOr(period, today()));
            created.endOn(endedOn);
            members.saveAndFlush(created);
            return period.isCurrent();
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
        return typeChanged || wasCurrent != period.isCurrent();
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

    private static Set<String> correctedFields(Person person, String firstName, String lastName, String email) {
        Set<String> changed = new LinkedHashSet<>();
        if (firstName != null && !person.getFirstName().equals(strippedNonBlank(firstName, "first name"))) {
            changed.add("firstName");
        }
        if (lastName != null && !person.getLastName().equals(strippedNonBlank(lastName, "last name"))) {
            changed.add("lastName");
        }
        if (email != null && !person.getEmail().equals(strippedAddress(email))) {
            changed.add("email");
        }
        return changed;
    }

    private static Set<String> changedFields(Person person, String firstName, String lastName, String email) {
        Set<String> changed = new LinkedHashSet<>();
        if (!person.getFirstName().equals(firstName)) changed.add("firstName");
        if (!person.getLastName().equals(lastName)) changed.add("lastName");
        if (!person.getEmail().equals(email)) changed.add("email");
        return changed;
    }

    private static UUID requiredPersonId(UUID personId) {
        if (personId == null) {
            throw new IllegalStateException("A person must be named by an id");
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
        if (!PersonFieldLimits.isUsableName(stripped)) {
            throw new IllegalStateException("A person's " + what
                    + " must not be blank, hold a line break or exceed "
                    + PersonFieldLimits.MAX_NAME_LENGTH + " characters");
        }
        return stripped;
    }

    private void requireAddressWhereAnAccountNeedsOne(UUID personId, String address) {
        if (address.isEmpty() && !accounts.findByPersonIdIn(List.of(personId)).isEmpty()) {
            throw new AccountAddressRequiredException("roster.person.addressHeldByAccount", Map.of());
        }
    }

    private static String strippedAddress(String value) {
        String stripped = value == null ? "" : PersonText.stripped(value);
        if (!PersonFieldLimits.isUsableOrAbsentEmail(stripped)) {
            throw new IllegalStateException("A person's email address must be absent or a usable "
                    + "address of at most " + PersonFieldLimits.MAX_EMAIL_LENGTH + " characters");
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

    private static RosterEntry toEntry(Person person, UserAccount account, Member member) {
        Membership membership = member == null ? null : new Membership(
                member.getMembershipTypeId(), member.getStartedOn(), member.getEndedOn());
        if (account == null) {
            return new RosterEntry(person.getId(), person.getFirstName(), person.getLastName(),
                    person.getEmail(), null, null, false, membership, Set.of());
        }
        return new RosterEntry(person.getId(), person.getFirstName(), person.getLastName(),
                person.getEmail(), account.getId(), account.getUsername(), account.isEnabled(),
                membership, account.getRoles());
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
                              Membership membership, Set<Role> roles) {

        public RosterEntry {
            roles = Set.copyOf(roles);
        }
    }

    public record Membership(UUID typeId, LocalDate startedOn, LocalDate endedOn) {
    }
}
