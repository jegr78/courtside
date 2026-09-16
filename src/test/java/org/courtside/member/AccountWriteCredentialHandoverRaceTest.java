package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.UserAccountRepository;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.internal.MembershipType;
import org.courtside.shared.CredentialIssuer;
import org.courtside.shared.IssuedCredential;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.InstanceOfAssertFactories.type;

@Timeout(value = 30, unit = TimeUnit.SECONDS)
@Import(IdentityTestFixture.class)
class AccountWriteCredentialHandoverRaceTest extends AbstractIntegrationTest {

    private static final LocalDate MEMBERSHIP_START = LocalDate.of(2026, 1, 1);

    @Autowired
    private RosterService roster;

    @Autowired
    private MemberService memberships;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private CredentialIssuer credentials;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private PlatformTransactionManager transactions;

    private UUID jane;
    private UUID accountId;
    private UUID membershipTypeId;
    private long epochBefore;

    @BeforeEach
    void createAnAccountAwaitingItsFirstCredential() {
        jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        accountId = identity.createAccountAwaitingCredentials(jane, "doe.jane", Set.of(Role.MEMBER));
        MembershipType type = memberships.createMembershipType("Junior", null, false);
        membershipTypeId = type.getId();
        epochBefore = identity.securityEpoch(accountId);
    }

    @Test
    void givenAnInteractiveAccountChangeInFlight_whenTheHandoverWritesTheSameAccount_thenItWaits()
            throws Exception {
        // given
        CountDownLatch membershipWritten = new CountDownLatch(1);
        CountDownLatch allowCommit = new CountDownLatch(1);

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> interactive = pool.submit(() -> new TransactionTemplate(transactions)
                    .executeWithoutResult(status -> {
                        roster.writeMembership(jane, membershipTypeId,
                                new MembershipPeriod(MEMBERSHIP_START, null));
                        membershipWritten.countDown();
                        await(allowCommit);
                    }));
            assertThat(membershipWritten.await(5, TimeUnit.SECONDS)).isTrue();

            // when
            Future<IssuedCredential> handover = pool.submit(() -> issue(accountId));

            // then
            assertThatThrownBy(() -> handover.get(250, TimeUnit.MILLISECONDS))
                    .as("the handover wrote the account the interactive change was still holding")
                    .isInstanceOf(TimeoutException.class);
            allowCommit.countDown();
            interactive.get(5, TimeUnit.SECONDS);
            IssuedCredential issued = assertThat(handover)
                    .as("the handover lost the version race, so no credential was issued and the "
                            + "member was never told")
                    .succeedsWithin(Duration.ofSeconds(5), type(IssuedCredential.class))
                    .actual();
            assertThat(identity.securityEpoch(accountId))
                    .as("one of the two revocations was lost instead of both reaching the account")
                    .isEqualTo(epochBefore + 2);
            assertThat(identity.credentialSignsIn(accountId, issued.credential()))
                    .as("the stored hash is not the credential the handover returned")
                    .isTrue();
        } finally {
            allowCommit.countDown();
            pool.shutdown();
        }
    }

    @Test
    void givenTheHandoverInFlight_whenAnInteractiveChangeWritesTheSameAccount_thenItWaits()
            throws Exception {
        // given
        CountDownLatch credentialIssued = new CountDownLatch(1);
        CountDownLatch allowCommit = new CountDownLatch(1);

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<IssuedCredential> handover = pool.submit(() -> new TransactionTemplate(transactions)
                    .execute(status -> {
                        IssuedCredential issued = issue(accountId);
                        credentialIssued.countDown();
                        await(allowCommit);
                        return issued;
                    }));
            assertThat(credentialIssued.await(5, TimeUnit.SECONDS)).isTrue();

            // when
            Future<?> interactive = pool.submit(() -> roster.writeMembership(jane, membershipTypeId,
                    new MembershipPeriod(MEMBERSHIP_START, null)));

            // then
            assertThatThrownBy(() -> interactive.get(250, TimeUnit.MILLISECONDS))
                    .as("the interactive change wrote the account the handover was still holding")
                    .isInstanceOf(TimeoutException.class);
            allowCommit.countDown();
            IssuedCredential issued = handover.get(5, TimeUnit.SECONDS);
            assertThat(interactive)
                    .as("the interactive change lost the version race and the board was told the "
                            + "record had been edited by somebody else")
                    .succeedsWithin(Duration.ofSeconds(5));
            assertThat(identity.securityEpoch(accountId))
                    .as("one of the two revocations was lost instead of both reaching the account")
                    .isEqualTo(epochBefore + 2);
            assertThat(identity.credentialSignsIn(accountId, issued.credential()))
                    .as("the interactive change overwrote the credential the handover had stored")
                    .isTrue();
        } finally {
            allowCommit.countDown();
            pool.shutdown();
        }
    }

    @Test
    void givenTheHandoverHoldingTheAccount_whenSomethingLocksThePerson_thenItIsNotHeldToo()
            throws Exception {
        // given
        CountDownLatch credentialIssued = new CountDownLatch(1);
        CountDownLatch allowCommit = new CountDownLatch(1);

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> handover = pool.submit(() -> new TransactionTemplate(transactions)
                    .executeWithoutResult(status -> {
                        issue(accountId);
                        credentialIssued.countDown();
                        await(allowCommit);
                    }));
            assertThat(credentialIssued.await(5, TimeUnit.SECONDS)).isTrue();

            // when
            Future<Boolean> personLock = pool.submit(() -> new TransactionTemplate(transactions)
                    .execute(status -> persons.findWithLockById(jane).isPresent()));

            // then
            assertThat(personLock)
                    .as("locking the account held the person row too, which inverts the order "
                            + "every roster writer takes and lets the two deadlock")
                    .succeedsWithin(Duration.ofSeconds(2))
                    .isEqualTo(true);
            allowCommit.countDown();
            handover.get(5, TimeUnit.SECONDS);
        } finally {
            allowCommit.countDown();
            pool.shutdown();
        }
    }

    @Test
    void givenTheRosterFinderHoldingTheAccounts_whenSomethingLocksThePerson_thenItIsNotHeldToo()
            throws Exception {
        // given
        CountDownLatch accountsLocked = new CountDownLatch(1);
        CountDownLatch allowCommit = new CountDownLatch(1);

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> writer = pool.submit(() -> new TransactionTemplate(transactions)
                    .executeWithoutResult(status -> {
                        accounts.findWithLockByPersonIdIn(List.of(jane));
                        accountsLocked.countDown();
                        await(allowCommit);
                    }));
            assertThat(accountsLocked.await(5, TimeUnit.SECONDS)).isTrue();

            // when
            Future<Boolean> personLock = pool.submit(() -> new TransactionTemplate(transactions)
                    .execute(status -> persons.findWithLockById(jane).isPresent()));

            // then
            assertThat(personLock)
                    .as("the finder every roster writer uses reaches the person row through "
                            + "person.id and held it too, which is the order they already hold")
                    .succeedsWithin(Duration.ofSeconds(2))
                    .isEqualTo(true);
            allowCommit.countDown();
            writer.get(5, TimeUnit.SECONDS);
        } finally {
            allowCommit.countDown();
            pool.shutdown();
        }
    }

    @Test
    void givenTheMessageStillOnItsWayToTheRelay_whenAnotherWriterTakesTheAccount_thenItIsNotHeld()
            throws Exception {
        // given
        ExecutorService pool = Executors.newFixedThreadPool(1);
        AtomicReference<Boolean> takenDuringHandover = new AtomicReference<>();

        try {
            // when
            credentials.issueFor(accountId, expiry(), issued -> {
                Future<Boolean> other = pool.submit(() -> new TransactionTemplate(transactions)
                        .execute(status -> !accounts.findWithLockByPersonIdIn(List.of(jane)).isEmpty()));
                takenDuringHandover.set(waitedFor(other));
            });

            // then
            assertThat(takenDuringHandover.get())
                    .as("the account row was already written and held while the message was still "
                            + "being handed to the relay, so a slow relay blocks the board")
                    .isTrue();
            assertThat(identity.securityEpoch(accountId))
                    .as("the handover did not write the account after the message went out")
                    .isEqualTo(epochBefore + 1);
        } finally {
            pool.shutdown();
        }
    }

    private static Boolean waitedFor(Future<Boolean> other) {
        try {
            return other.get(2, TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            return false;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while taking the account row", e);
        } catch (java.util.concurrent.ExecutionException e) {
            throw new IllegalStateException("Could not take the account row", e);
        }
    }

    private IssuedCredential issue(UUID accountId) {
        AtomicReference<IssuedCredential> handedOver = new AtomicReference<>();
        credentials.issueFor(accountId, expiry(), handedOver::set);
        return handedOver.get();
    }

    private static Instant expiry() {
        return Instant.now().plus(7, ChronoUnit.DAYS);
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Timed out while coordinating concurrent transactions");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while coordinating concurrent transactions", e);
        }
    }
}
