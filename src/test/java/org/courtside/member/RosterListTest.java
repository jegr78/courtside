package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.internal.RosterCursorUnknownException;
import org.courtside.shared.CursorPage;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.courtside.member.MemberFixtures.memberSince;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import(IdentityTestFixture.class)
class RosterListTest extends AbstractIntegrationTest {

    private static final UUID MEMBERSHIP_TYPE_ID = UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    private static final String LOWEST_IDS = "01234";
    private static final String MIDDLE_IDS = "56789a";
    private static final String HIGHEST_IDS = "bcdef";

    @Autowired
    private IdentityTestFixture identity;

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
        UUID child = identity.createPerson("Mary", "Major", "mary.major@example.org");

        // when
        CursorPage.Result<RosterService.RosterEntry> page = roster.list(null, null, 50);

        // then
        assertThat(page.items())
                .filteredOn(entry -> entry.personId().equals(child))
                .singleElement()
                .satisfies(entry -> {
                    assertThat(entry.accountId()).isNull();
                    assertThat(entry.username()).isNull();
                    assertThat(entry.enabled()).isFalse();
                    assertThat(entry.roles()).isEmpty();
                    assertThat(entry.membership()).isNull();
                });
    }

    @Test
    void givenAPersonWithAnAccountAndAMembership_whenListingTheRoster_thenTheEntryCarriesBoth() {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID account = identity.createEnabledAccount(
                jane, "jane.doe", Set.of(Role.MEMBER, Role.TRAINER));
        members.save(memberSince(jane, MEMBERSHIP_TYPE_ID));

        // when
        CursorPage.Result<RosterService.RosterEntry> page = roster.list(null, null, 50);

        // then
        assertThat(page.items())
                .filteredOn(entry -> entry.personId().equals(jane))
                .singleElement()
                .satisfies(entry -> {
                    assertThat(entry.firstName()).isEqualTo("Jane");
                    assertThat(entry.lastName()).isEqualTo("Doe");
                    assertThat(entry.email()).isEqualTo("jane.doe@example.org");
                    assertThat(entry.accountId()).isEqualTo(account);
                    assertThat(entry.username()).isEqualTo("jane.doe");
                    assertThat(entry.enabled()).isTrue();
                    assertThat(entry.roles()).containsExactlyInAnyOrder(Role.MEMBER, Role.TRAINER);
                    assertThat(entry.membership().typeId()).isEqualTo(MEMBERSHIP_TYPE_ID);
                });
    }

    @Test
    void givenAQuery_whenListingTheRoster_thenOnlyMatchingPeopleAreReturned() {
        // given
        identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID other = identity.createPerson("Richard", "Miles", "richard.miles@example.org");

        // when
        CursorPage.Result<RosterService.RosterEntry> page = roster.list("mile", null, 50);

        // then
        assertThat(page.items()).extracting(RosterService.RosterEntry::personId)
                .containsExactly(other);
    }

    @Test
    void givenAQueryOfLikeWildcards_whenListingTheRoster_thenTheyAreMatchedLiterally() {
        // given
        identity.createPerson("Jane", "Doe", "jane.doe@example.org");

        // when
        CursorPage.Result<RosterService.RosterEntry> page = roster.list("%", null, 50);

        // then
        assertThat(page.items()).isEmpty();
    }

    @Test
    void whenListingTheRoster_thenPeopleComeOrderedByName() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        UUID john = identity.createPerson("John", "Roe", "john.roe@example.org");
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");

        // when
        CursorPage.Result<RosterService.RosterEntry> page = roster.list(null, null, 50);

        // then
        assertThat(page.items()).extracting(RosterService.RosterEntry::personId)
                .containsExactly(jane, mary, john);
        assertThat(page.nextCursor()).isNull();
    }

    @Test
    void givenMorePeopleThanTheLimit_whenFollowingTheCursor_thenEveryPersonIsSeenExactlyOnce() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        UUID john = identity.createPerson("John", "Roe", "john.roe@example.org");
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID richard = identity.createPerson("Richard", "Miles", "richard.miles@example.org");

        // when
        CursorPage.Result<RosterService.RosterEntry> first = roster.list(null, null, 2);
        CursorPage.Result<RosterService.RosterEntry> second = roster.list(null, first.nextCursor(), 2);

        // then
        assertThat(first.items()).extracting(RosterService.RosterEntry::personId)
                .containsExactly(jane, mary);
        assertThat(first.nextCursor()).isEqualTo(mary);
        assertThat(second.items()).extracting(RosterService.RosterEntry::personId)
                .containsExactly(richard, john);
        assertThat(second.nextCursor()).isNull();
    }

    @Test
    void givenIdsThatContradictTheNameOrder_whenFollowingTheCursor_thenTheNextPageContinuesByName() {
        // given
        UUID jane = identity.createPersonWithLeadingIdDigitIn(
                "Jane", "Doe", "jane.doe@example.org", HIGHEST_IDS);
        UUID mary = identity.createPersonWithLeadingIdDigitIn(
                "Mary", "Major", "mary.major@example.org", MIDDLE_IDS);
        UUID john = identity.createPersonWithLeadingIdDigitIn(
                "John", "Roe", "john.roe@example.org", LOWEST_IDS);

        // when
        CursorPage.Result<RosterService.RosterEntry> first = roster.list(null, null, 2);
        CursorPage.Result<RosterService.RosterEntry> second = roster.list(null, first.nextCursor(), 2);

        // then
        assertThat(first.items()).extracting(RosterService.RosterEntry::personId)
                .containsExactly(jane, mary);
        assertThat(first.nextCursor()).isEqualTo(mary);
        assertThat(second.items()).extracting(RosterService.RosterEntry::personId)
                .containsExactly(john);
        assertThat(second.nextCursor()).isNull();
    }

    @Test
    void givenPeopleSharingAName_whenFollowingTheCursor_thenTheIdTiebreakOrdersThemStably() {
        // given
        List<UUID> byId = java.util.stream.Stream.of(
                        identity.createPerson("Jane", "Doe", "jane.doe.1@example.org"),
                        identity.createPerson("Jane", "Doe", "jane.doe.2@example.org"),
                        identity.createPerson("Jane", "Doe", "jane.doe.3@example.org"))
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
        identity.createPerson("Jane", "Doe", "jane.doe@example.org");

        // when / then
        assertThatThrownBy(() -> roster.list(null, UUID.randomUUID(), 50))
                .isInstanceOf(RosterCursorUnknownException.class)
                .satisfies(failure -> assertThat(((RosterCursorUnknownException) failure).getCode())
                        .isEqualTo("roster.cursor.unknown"));
    }

    @Test
    void givenAPersonHoldingTwoAccounts_whenListingTheRoster_thenTheEnabledOneRepresentsThem() {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        identity.createAccount(jane, "jane.doe.dormant", Set.of(Role.MEMBER));
        UUID current = identity.createEnabledAccount(jane, "jane.doe", Set.of(Role.TRAINER));

        // when
        CursorPage.Result<RosterService.RosterEntry> page = roster.list(null, null, 50);

        // then
        assertThat(page.items())
                .singleElement()
                .satisfies(entry -> {
                    assertThat(entry.accountId()).isEqualTo(current);
                    assertThat(entry.username()).isEqualTo("jane.doe");
                    assertThat(entry.enabled()).isTrue();
                    assertThat(entry.roles()).containsExactly(Role.TRAINER);
                });
    }

    @Test
    void givenTwoEnabledAccountsWhoseAgeContradictsTheirIds_whenListingTheRoster_thenTheOlderRepresentsThem() {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UserAccount one = accounts.findById(identity.createEnabledAccount(
                jane, "jane.doe.one", Set.of(Role.MEMBER))).orElseThrow();
        UserAccount other = accounts.findById(identity.createEnabledAccount(
                jane, "jane.doe.other", Set.of(Role.TRAINER))).orElseThrow();
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

}
