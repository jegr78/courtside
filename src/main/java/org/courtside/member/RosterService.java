package org.courtside.member;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.CursorPage;
import org.springframework.data.domain.PageRequest;
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

    private static final Comparator<UserAccount> ACCOUNT_PRECEDENCE =
            Comparator.comparing(UserAccount::isEnabled, Comparator.reverseOrder())
                    .thenComparing(UserAccount::getCreatedAt)
                    .thenComparing(UserAccount::getId);

    private final PersonRepository persons;
    private final UserAccountRepository accounts;
    private final MemberRepository members;

    public CursorPage.Result<RosterEntry> list(String query, UUID cursor, int limit) {
        validateLimit(limit);
        requireKnownCursor(cursor);
        String normalized = normalize(query);
        List<UUID> ids = persons.findRosterIds(normalized, cursor, PageRequest.of(0, limit + 1));
        return CursorPage.of(ids, limit, this::load, RosterEntry::personId);
    }

    @Transactional
    public RosterEntry createPerson(String firstName, String lastName, String email) {
        requireDetails(firstName, lastName, email);
        return toEntry(persons.save(new Person(firstName, lastName, email)), null, null);
    }

    @Transactional
    public RosterEntry changePerson(UUID personId, String firstName, String lastName, String email) {
        requireDetails(firstName, lastName, email);
        if (personId == null) {
            throw new IllegalStateException("A person to change must be named by an id");
        }
        Person person = persons.findById(personId)
                .orElseThrow(() -> new PersonNotFoundException("No person with id " + personId));
        person.rename(firstName, lastName);
        person.changeEmail(email);
        return load(List.of(person.getId())).getFirst();
    }

    private static void requireDetails(String firstName, String lastName, String email) {
        requirePresent(firstName, "first name");
        requirePresent(lastName, "last name");
        requirePresent(email, "email address");
    }

    private static void requirePresent(String value, String what) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("A person's " + what + " must not be blank");
        }
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
