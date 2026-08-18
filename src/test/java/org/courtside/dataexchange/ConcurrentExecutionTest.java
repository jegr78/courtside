package org.courtside.dataexchange;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.MemberRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.util.Map;
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

@Timeout(value = 60, unit = TimeUnit.SECONDS)
@Import(IdentityTestFixture.class)
class ConcurrentExecutionTest extends AbstractIntegrationTest {

    private static final UUID ACTIVE_TYPE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    private static final String TWO_MEMBERS = """
            Member number,First name,Last name,Email
            4711,Jane,Doe,jane.doe@example.org
            4712,John,Roe,john.roe@example.org
            """;

    @Autowired
    private PreviewService previews;

    @Autowired
    private ExecutionService executions;

    @Autowired
    private ImportSourceService sources;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberRepository members;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private PlatformTransactionManager transactions;

    private UUID source;
    private UUID actor;

    @BeforeEach
    void setUp() {
        source = sources.create("roster-system", "Membership system",
                Map.of("Member number", CanonicalField.EXTERNAL_ID,
                        "First name", CanonicalField.FIRST_NAME,
                        "Last name", CanonicalField.LAST_NAME,
                        "Email", CanonicalField.EMAIL),
                Map.of(), ACTIVE_TYPE, Set.of(CanonicalField.FIRST_NAME), 10).sourceId();
        UUID admin = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        actor = identity.createAccount(admin, "admin", Set.of(Role.ADMIN));
    }

    @Test
    void givenTwoExecutionsOfOneSourceAtOnce_whenBothAreInFlight_thenTheSecondSeesTheFirstsOutcome()
            throws Exception {
        // given
        UUID first = preview(TWO_MEMBERS);
        UUID second = preview(TWO_MEMBERS);
        CountDownLatch firstApplied = new CountDownLatch(1);
        CountDownLatch allowCommit = new CountDownLatch(1);

        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            Future<?> running = pool.submit(() -> new TransactionTemplate(transactions)
                    .executeWithoutResult(status -> {
                        executions.execute(second, false, actor);
                        firstApplied.countDown();
                        await(allowCommit);
                    }));
            assertThat(firstApplied.await(10, TimeUnit.SECONDS)).isTrue();

            // when
            Future<?> queued = pool.submit(() -> executions.execute(first, false, actor));

            // then
            assertThatThrownBy(() -> queued.get(250, TimeUnit.MILLISECONDS))
                    .isInstanceOf(TimeoutException.class);
            allowCommit.countDown();
            running.get(10, TimeUnit.SECONDS);
            assertThatThrownBy(() -> queued.get(10, TimeUnit.SECONDS))
                    .isInstanceOf(ExecutionException.class)
                    .hasCauseInstanceOf(ImportPreviewSupersededException.class);
            assertThat(persons.count()).isEqualTo(3);
            assertThat(members.count()).isEqualTo(2);
        } finally {
            allowCommit.countDown();
        }
    }

    @Test
    void givenOnePreviewExecutedTwiceAtOnce_whenBothAreInFlight_thenTheLoserIsToldItIsSuperseded()
            throws Exception {
        // given
        UUID only = preview(TWO_MEMBERS);
        CountDownLatch applied = new CountDownLatch(1);
        CountDownLatch allowCommit = new CountDownLatch(1);

        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            Future<?> running = pool.submit(() -> new TransactionTemplate(transactions)
                    .executeWithoutResult(status -> {
                        executions.execute(only, false, actor);
                        applied.countDown();
                        await(allowCommit);
                    }));
            assertThat(applied.await(10, TimeUnit.SECONDS)).isTrue();

            // when
            Future<?> queued = pool.submit(() -> executions.execute(only, false, actor));
            allowCommit.countDown();
            running.get(10, TimeUnit.SECONDS);

            // then
            assertThatThrownBy(() -> queued.get(10, TimeUnit.SECONDS))
                    .isInstanceOf(ExecutionException.class)
                    .hasCauseInstanceOf(ImportPreviewSupersededException.class);
            assertThat(persons.count()).isEqualTo(3);
            assertThat(members.count()).isEqualTo(2);
        } finally {
            allowCommit.countDown();
        }
    }

    private UUID preview(String content) {
        return previews.create(source, SnapshotMode.FULL_SNAPSHOT, "roster.csv",
                content.getBytes(StandardCharsets.UTF_8), actor).previewId();
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(10, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Timed out while coordinating concurrent transactions");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while coordinating concurrent transactions", e);
        }
    }
}
