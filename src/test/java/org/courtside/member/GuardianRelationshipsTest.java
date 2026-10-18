package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.internal.GuardianRelationship;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.LocalDate;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import(IdentityTestFixture.class)
class GuardianRelationshipsTest extends AbstractIntegrationTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 5, 12);

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private GuardianshipService guardianships;

    @Autowired
    private GuardianRelationships relationships;

    private UUID jane;
    private UUID john;
    private UUID janeAccount;
    private UUID johnAccount;

    @BeforeEach
    void setUp() {
        jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        john = identity.createPerson("John", "Roe", "john.roe@example.org");
        janeAccount = identity.createEnabledAccount(jane, "jane.doe", Set.of(Role.MEMBER));
        johnAccount = identity.createEnabledAccount(john, "john.roe", Set.of(Role.MEMBER));
    }

    @Test
    void givenARunningRelationship_whenAskingForAGrantedAction_thenTheGuardianMayActOnlyForThatOne() {
        // given
        guardianships.create(jane, jane, john, EnumSet.of(GuardianGrant.VIEW_BOOKINGS, GuardianGrant.BOOK), null);

        // when / then
        assertThat(mayActFor(jane, john, GuardianGrant.BOOK, TODAY)).isTrue();
        assertThat(mayActFor(jane, john, GuardianGrant.CANCEL_BOOKINGS, TODAY))
                .as("an action the relationship does not grant").isFalse();
        assertThat(mayActFor(john, jane, GuardianGrant.BOOK, TODAY))
                .as("the dependant may not act for the guardian").isFalse();
        assertThat(dependantsOf(jane, GuardianGrant.VIEW_BOOKINGS)).containsExactly(john);
        assertThat(dependantsOf(jane, GuardianGrant.READ_MESSAGES)).isEmpty();
    }

    @Test
    void givenAnEndInTheFuture_whenAskingAcrossIt_thenTheRelationshipGrantsUntilTheDayBeforeTheEnd() {
        // given
        guardianships.create(john, jane, john, Set.of(GuardianGrant.BOOK), LocalDate.of(2026, 6, 1));

        // when / then
        assertThat(mayActFor(jane, john, GuardianGrant.BOOK, LocalDate.of(2026, 5, 31))).isTrue();
        assertThat(mayActFor(jane, john, GuardianGrant.BOOK, LocalDate.of(2026, 6, 1)))
                .as("the end is the first day without the relationship").isFalse();
        assertThat(mayActFor(jane, john, GuardianGrant.BOOK, TODAY.minusDays(1)))
                .as("the relationship began today").isFalse();
    }

    @Test
    void givenADependantReachingAdulthood_whenTheBoardEndsTheRelationshipToday_thenNothingIsGrantedToday() {
        // given
        UUID id = guardianships.create(jane, jane, john, Set.of(GuardianGrant.BOOK), null).id();

        // when
        guardianships.end(jane, id);

        // then
        assertThat(mayActFor(jane, john, GuardianGrant.BOOK, TODAY)).isFalse();
        assertThat(dependantsOf(jane, GuardianGrant.BOOK)).isEmpty();
    }

    @Test
    void givenAGuardianWhoseAccountIsDisabled_whenAskingForAnyAction_thenNothingIsGranted() {
        // given
        guardianships.create(jane, jane, john, Set.of(GuardianGrant.BOOK), null);

        // when
        identity.disableAccount(janeAccount);

        // then
        assertThat(mayActFor(jane, john, GuardianGrant.BOOK, TODAY)).isFalse();
        assertThat(dependantsOf(jane, GuardianGrant.BOOK)).isEmpty();
    }

    @Test
    void givenAGuardianOrDependantWhoseAccountWasRemoved_whenAskingForAnyAction_thenNothingIsGranted() {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        UUID maryAccount = identity.createEnabledAccount(mary, "mary.major", Set.of(Role.MEMBER));
        guardianships.create(jane, jane, john, Set.of(GuardianGrant.BOOK), null);
        guardianships.create(mary, mary, john, Set.of(GuardianGrant.BOOK), null);

        // when
        identity.removeAccount(johnAccount);
        identity.removeAccount(maryAccount);

        // then
        assertThat(mayActFor(jane, john, GuardianGrant.BOOK, TODAY))
                .as("a dependant without an account").isFalse();
        assertThat(dependantsOf(jane, GuardianGrant.BOOK)).isEmpty();
        assertThat(mayActFor(mary, john, GuardianGrant.BOOK, TODAY))
                .as("a guardian without an account").isFalse();
    }

    @Test
    void givenBothPeopleHoldingADormantAccountBesideACurrentOne_whenAsking_thenTheCurrentAccountsCount() {
        // given
        identity.createAccount(jane, "jane.doe.dormant", Set.of(Role.MEMBER));
        identity.createAccount(john, "john.roe.dormant", Set.of(Role.MEMBER));
        guardianships.create(jane, jane, john, Set.of(GuardianGrant.BOOK), null);

        // when / then
        assertThat(mayActFor(jane, john, GuardianGrant.BOOK, TODAY))
                .as("a dormant account beside an enabled one does not hide the guardian").isTrue();
        assertThat(relationships.accountOf(john)).as("the dependant acts through the enabled account")
                .hasValueSatisfying(account -> assertThat(account.getId()).isEqualTo(johnAccount));
        identity.disableAccount(janeAccount);
        assertThat(mayActFor(jane, john, GuardianGrant.BOOK, TODAY))
                .as("only disabled accounts left").isFalse();
    }

    @Test
    void givenADependantWhoseAccountIsDisabled_whenTheGuardianAsks_thenTheGuardianMayStillAct() {
        // given
        guardianships.create(jane, jane, john, Set.of(GuardianGrant.ACCOUNT_TASKS), null);

        // when
        identity.disableAccount(johnAccount);

        // then
        assertThat(mayActFor(jane, john, GuardianGrant.ACCOUNT_TASKS, TODAY))
                .as("the dependant still holds an account").isTrue();
    }

    private boolean mayActFor(UUID guardian, UUID dependant, GuardianGrant grant, LocalDate day) {
        return relationships.grantsFor(guardian, dependant, day).map(granted -> granted.contains(grant))
                .orElse(false);
    }

    private List<UUID> dependantsOf(UUID guardian, GuardianGrant grant) {
        return relationships.runningFor(guardian, TODAY).stream()
                .filter(relationship -> relationship.getGrants().contains(grant))
                .map(GuardianRelationship::getDependantPersonId)
                .toList();
    }
}
