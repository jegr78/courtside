package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.internal.MembershipPeriodsOverlapException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
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
class MembershipPeriodConcurrencyTest extends AbstractIntegrationTest {

    private static final UUID ACTIVE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID YOUTH = UUID.fromString("cccccccc-0000-0000-0000-000000000002");

    @Autowired
    private MembershipPeriodService periods;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private PlatformTransactionManager transactions;

    @Test
    void givenTwoBoardMembersAddingOverlappingPeriodsAtOnce_whenBothAreInFlight_thenTheSecondWaitsAndIsRefused()
            throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        CountDownLatch firstAdded = new CountDownLatch(1);
        CountDownLatch allowCommit = new CountDownLatch(1);

        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            Future<?> first = pool.submit(() -> new TransactionTemplate(transactions)
                    .executeWithoutResult(status -> {
                        periods.add(mary, ACTIVE, new MembershipPeriod(LocalDate.of(2026, 1, 1), null));
                        firstAdded.countDown();
                        await(allowCommit);
                    }));
            assertThat(firstAdded.await(5, TimeUnit.SECONDS)).isTrue();

            // when
            Future<?> second = pool.submit(() ->
                    periods.add(mary, YOUTH, new MembershipPeriod(LocalDate.of(2026, 3, 1), null)));

            // then
            assertThatThrownBy(() -> second.get(250, TimeUnit.MILLISECONDS))
                    .as("the person lock makes the second writer wait for the first")
                    .isInstanceOf(TimeoutException.class);
            allowCommit.countDown();
            first.get(5, TimeUnit.SECONDS);
            assertThatThrownBy(() -> second.get(5, TimeUnit.SECONDS))
                    .isInstanceOf(ExecutionException.class)
                    .hasCauseInstanceOf(MembershipPeriodsOverlapException.class);
            assertThat(periods.periodsOf(mary)).singleElement()
                    .satisfies(period -> assertThat(period.membershipTypeId()).isEqualTo(ACTIVE));
        } finally {
            allowCommit.countDown();
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(10, TimeUnit.SECONDS)) {
                throw new IllegalStateException("The test never released the first writer");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }
}
