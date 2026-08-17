package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.internal.RosterCursorUnknownException;
import org.courtside.shared.CursorPage;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;

import static org.courtside.member.MemberFixtures.memberSince;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RosterListTest extends AbstractIntegrationTest {

    private static final UUID MEMBERSHIP_TYPE_ID = UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    private static final String LOWEST_IDS = "01234";
    private static final String MIDDLE_IDS = "56789a";
    private static final String HIGHEST_IDS = "bcdef";

    @Autowired
    private PersonRepository persons;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private MemberRepository members;

    @Autowired
    private RosterService roster;

    @Test
    void givenAPersonWithoutAnAccount_whenListingTheRoster_thenTheEntryCarriesNoUsername() {
        // given
        Person child = persons.save(new Person("Mary", "Major", "mary.major@example.org"));

        // when
        CursorPage.Result<RosterService.RosterEntry> page = roster.list(null, null, 50);

        // then
        assertThat(page.items())
                .filteredOn(entry -> entry.personId().equals(child.getId()))
                .singleElement()
                .satisfies(entry -> {
                    assertThat(entry.accountId()).isNull();
                    assertThat(entry.username()).isNull();
                    assertThat(entry.enabled()).isFalse();
                    assertThat(entry.roles()).isEmpty();
                    assertThat(entry.membershipTypeId()).isNull();
                });
    }

    @Test
    void givenAPersonWithAnAccountAndAMembership_whenListingTheRoster_thenTheEntryCarriesBoth() {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        UserAccount account = new UserAccount(jane, "jane.doe", "hash", Set.of(Role.MEMBER, Role.TRAINER));
        account.enable();
        accounts.save(account);
        members.save(memberSince(jane.getId(), MEMBERSHIP_TYPE_ID));

        // when
        CursorPage.Result<RosterService.RosterEntry> page = roster.list(null, null, 50);

        // then
        assertThat(page.items())
                .filteredOn(entry -> entry.personId().equals(jane.getId()))
                .singleElement()
                .satisfies(entry -> {
                    assertThat(entry.firstName()).isEqualTo("Jane");
                    assertThat(entry.lastName()).isEqualTo("Doe");
                    assertThat(entry.email()).isEqualTo("jane.doe@example.org");
                    assertThat(entry.accountId()).isEqualTo(account.getId());
                    assertThat(entry.username()).isEqualTo("jane.doe");
                    assertThat(entry.enabled()).isTrue();
                    assertThat(entry.roles()).containsExactlyInAnyOrder(Role.MEMBER, Role.TRAINER);
                    assertThat(entry.membershipTypeId()).isEqualTo(MEMBERSHIP_TYPE_ID);
                });
    }

    @Test
    void givenAQuery_whenListingTheRoster_thenOnlyMatchingPeopleAreReturned() {
        // given
        persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        Person other = persons.save(new Person("Richard", "Miles", "richard.miles@example.org"));

        // when
        CursorPage.Result<RosterService.RosterEntry> page = roster.list("mile", null, 50);

        // then
        assertThat(page.items()).extracting(RosterService.RosterEntry::personId)
                .containsExactly(other.getId());
    }

    @Test
    void givenAQueryOfLikeWildcards_whenListingTheRoster_thenTheyAreMatchedLiterally() {
        // given
        persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));

        // when
        CursorPage.Result<RosterService.RosterEntry> page = roster.list("%", null, 50);

        // then
        assertThat(page.items()).isEmpty();
    }

    @Test
    void whenListingTheRoster_thenPeopleComeOrderedByName() {
        // given
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));
        Person john = persons.save(new Person("John", "Roe", "john.roe@example.org"));
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));

        // when
        CursorPage.Result<RosterService.RosterEntry> page = roster.list(null, null, 50);

        // then
        assertThat(page.items()).extracting(RosterService.RosterEntry::personId)
                .containsExactly(jane.getId(), mary.getId(), john.getId());
        assertThat(page.nextCursor()).isNull();
    }

    @Test
    void givenMorePeopleThanTheLimit_whenFollowingTheCursor_thenEveryPersonIsSeenExactlyOnce() {
        // given
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));
        Person john = persons.save(new Person("John", "Roe", "john.roe@example.org"));
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        Person richard = persons.save(new Person("Richard", "Miles", "richard.miles@example.org"));

        // when
        CursorPage.Result<RosterService.RosterEntry> first = roster.list(null, null, 2);
        CursorPage.Result<RosterService.RosterEntry> second = roster.list(null, first.nextCursor(), 2);

        // then
        assertThat(first.items()).extracting(RosterService.RosterEntry::personId)
                .containsExactly(jane.getId(), mary.getId());
        assertThat(first.nextCursor()).isEqualTo(mary.getId());
        assertThat(second.items()).extracting(RosterService.RosterEntry::personId)
                .containsExactly(richard.getId(), john.getId());
        assertThat(second.nextCursor()).isNull();
    }

    @Test
    void givenIdsThatContradictTheNameOrder_whenFollowingTheCursor_thenTheNextPageContinuesByName() {
        // given
        Person jane = savePersonWithLeadingIdDigitIn("Jane", "Doe", "jane.doe@example.org", HIGHEST_IDS);
        Person mary = savePersonWithLeadingIdDigitIn("Mary", "Major", "mary.major@example.org", MIDDLE_IDS);
        Person john = savePersonWithLeadingIdDigitIn("John", "Roe", "john.roe@example.org", LOWEST_IDS);

        // when
        CursorPage.Result<RosterService.RosterEntry> first = roster.list(null, null, 2);
        CursorPage.Result<RosterService.RosterEntry> second = roster.list(null, first.nextCursor(), 2);

        // then
        assertThat(first.items()).extracting(RosterService.RosterEntry::personId)
                .containsExactly(jane.getId(), mary.getId());
        assertThat(first.nextCursor()).isEqualTo(mary.getId());
        assertThat(second.items()).extracting(RosterService.RosterEntry::personId)
                .containsExactly(john.getId());
        assertThat(second.nextCursor()).isNull();
    }

    @Test
    void givenPeopleSharingAName_whenFollowingTheCursor_thenTheIdTiebreakOrdersThemStably() {
        // given
        List<UUID> byId = Stream.of(
                        persons.save(new Person("Jane", "Doe", "jane.doe.1@example.org")),
                        persons.save(new Person("Jane", "Doe", "jane.doe.2@example.org")),
                        persons.save(new Person("Jane", "Doe", "jane.doe.3@example.org")))
                .map(Person::getId)
                .sorted(Comparator.comparing(UUID::toString))
                .toList();

        // when
        CursorPage.Result<RosterService.RosterEntry> first = roster.list(null, null, 2);
        CursorPage.Result<RosterService.RosterEntry> second = roster.list(null, first.nextCursor(), 2);

        // then
        assertThat(first.items()).extracting(RosterService.RosterEntry::personId)
                .containsExactly(byId.get(0), byId.get(1));
        assertThat(second.items()).extracting(RosterService.RosterEntry::personId)
                .containsExactly(byId.get(2));
    }

    @Test
    void givenACursorNamingSomebodyWhoIsGone_whenListingTheRoster_thenTheStaleCursorIsReported() {
        // given
        persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));

        // when / then
        assertThatThrownBy(() -> roster.list(null, UUID.randomUUID(), 50))
                .isInstanceOf(RosterCursorUnknownException.class)
                .satisfies(failure -> assertThat(((RosterCursorUnknownException) failure).getCode())
                        .isEqualTo("roster.cursor.unknown"));
    }

    @Test
    void givenAPersonHoldingTwoAccounts_whenListingTheRoster_thenTheEnabledOneRepresentsThem() {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        accounts.save(new UserAccount(jane, "jane.doe.dormant", "hash", Set.of(Role.MEMBER)));
        UserAccount current = new UserAccount(jane, "jane.doe", "hash", Set.of(Role.TRAINER));
        current.enable();
        accounts.save(current);

        // when
        CursorPage.Result<RosterService.RosterEntry> page = roster.list(null, null, 50);

        // then
        assertThat(page.items())
                .singleElement()
                .satisfies(entry -> {
                    assertThat(entry.accountId()).isEqualTo(current.getId());
                    assertThat(entry.username()).isEqualTo("jane.doe");
                    assertThat(entry.enabled()).isTrue();
                    assertThat(entry.roles()).containsExactly(Role.TRAINER);
                });
    }

    @Test
    void givenTwoEnabledAccountsWhoseAgeContradictsTheirIds_whenListingTheRoster_thenTheOlderRepresentsThem() {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        UserAccount one = enabled(new UserAccount(jane, "jane.doe.one", "hash", Set.of(Role.MEMBER)));
        UserAccount other = enabled(new UserAccount(jane, "jane.doe.other", "hash", Set.of(Role.TRAINER)));
        accounts.save(one);
        accounts.save(other);
        // The account made older is the one with the larger id, so an id-only tiebreak picks the other.
        UserAccount older = one.getId().compareTo(other.getId()) > 0 ? one : other;
        jdbc.sql("UPDATE user_account SET created_at = :createdAt WHERE id = :id")
                .param("createdAt", OffsetDateTime.parse("2020-01-01T00:00:00Z"))
                .param("id", older.getId())
                .update();

        // when
        CursorPage.Result<RosterService.RosterEntry> page = roster.list(null, null, 50);

        // then
        assertThat(page.items())
                .singleElement()
                .satisfies(entry -> assertThat(entry.accountId())
                        .as("two accounts in the same state are separated by age, not by id")
                        .isEqualTo(older.getId()));
    }

    private static UserAccount enabled(UserAccount account) {
        account.enable();
        return account;
    }

    // PostgreSQL orders a uuid bytewise, so the leading hex digit alone decides where an id sorts.
    private Person savePersonWithLeadingIdDigitIn(
            String firstName, String lastName, String email, String allowedDigits) {
        Person person = new Person(firstName, lastName, email);
        while (allowedDigits.indexOf(person.getId().toString().charAt(0)) < 0) {
            person = new Person(firstName, lastName, email);
        }
        return persons.save(person);
    }
}
