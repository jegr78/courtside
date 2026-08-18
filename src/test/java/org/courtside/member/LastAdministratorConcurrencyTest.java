package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.internal.LastAdministratorException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Timeout(value = 30, unit = TimeUnit.SECONDS)
@Import(IdentityTestFixture.class)
class LastAdministratorConcurrencyTest extends AbstractIntegrationTest {

    @Autowired
    private RosterService roster;


    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private PlatformTransactionManager transactions;

    @Test
    void givenTwoAdministratorsSteppingDownAtOnce_whenBothAreInFlight_thenTheSecondIsRefused()
            throws Exception {
        // given
        UUID jane = enabledAdministrator("Jane", "Doe", "doe.jane");
        UUID mary = enabledAdministrator("Mary", "Major", "major.mary");
        CountDownLatch firstDemoted = new CountDownLatch(1);
        CountDownLatch allowCommit = new CountDownLatch(1);

        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            Future<?> first = pool.submit(() -> new TransactionTemplate(transactions)
                    .executeWithoutResult(status -> {
                        roster.changeRoles(jane, Set.of(Role.MEMBER));
                        firstDemoted.countDown();
                        await(allowCommit);
                    }));
            assertThat(firstDemoted.await(5, TimeUnit.SECONDS)).isTrue();

            // when
            Future<?> second = pool.submit(() -> roster.changeRoles(mary, Set.of(Role.MEMBER)));

            // then
            assertThatThrownBy(() -> second.get(250, TimeUnit.MILLISECONDS))
                    .isInstanceOf(TimeoutException.class);
            allowCommit.countDown();
            first.get(5, TimeUnit.SECONDS);
            assertThatThrownBy(() -> second.get(5, TimeUnit.SECONDS))
                    .isInstanceOf(ExecutionException.class)
                    .hasCauseInstanceOf(LastAdministratorException.class);
            assertThat(accounts.findByUsername("major.mary")).get()
                    .satisfies(account -> assertThat(account.getRoles()).contains(Role.ADMIN));
        } finally {
            allowCommit.countDown();
        }
    }

    private UUID enabledAdministrator(String firstName, String lastName, String username) {
        UUID person = identity.createPerson(firstName, lastName,
                username + "@example.org");
        identity.createEnabledAccount(person, username, Set.of(Role.ADMIN));
        return person;
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
