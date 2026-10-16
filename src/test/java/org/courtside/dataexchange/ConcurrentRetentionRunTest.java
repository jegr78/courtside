package org.courtside.dataexchange;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;

@Import({IdentityTestFixture.class, MemberTestFixture.class})
class ConcurrentRetentionRunTest extends AbstractIntegrationTest {

    private static final UUID ACTIVE_TYPE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    @Autowired
    private RetentionService retention;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture roster;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private PlatformTransactionManager transactions;

    @Test
    void givenOnePreview_whenTwoBoardsConfirmItAtOnce_thenItRunsOnceAndTheOtherFindsNoPreview() throws Exception {
        // given
        UUID board = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        UUID admin = identity.createAccount(board, "admin", Set.of(Role.ADMIN));
        UUID formerMember = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        roster.assignMembership(formerMember, ACTIVE_TYPE, LocalDate.of(2018, 1, 1));
        jdbc.sql("UPDATE member SET ended_on = DATE '2023-06-30' WHERE person_id = :id")
                .param("id", formerMember).update();
        retention.setPolicy(RetentionCategory.FORMER_MEMBERS, 24);
        UUID previewId = retention.preview(admin).previewId();
        CountDownLatch start = new CountDownLatch(1);
        Callable<Object> confirm = () -> {
            start.await();
            try {
                return retention.run(previewId, admin);
            } catch (RetentionPreviewNotFoundException refused) {
                return refused;
            }
        };

        // when
        List<Object> outcomes = new ArrayList<>();
        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            Future<Object> first = pool.submit(confirm);
            Future<Object> second = pool.submit(confirm);
            start.countDown();
            outcomes.add(first.get());
            outcomes.add(second.get());
        }

        // then
        assertThat(outcomes).as("one confirmation runs the preview and the other finds it used up")
                .hasExactlyElementsOfTypes(outcomes.getFirst() instanceof RetentionPlan.Run
                        ? new Class<?>[]{RetentionPlan.Run.class, RetentionPreviewNotFoundException.class}
                        : new Class<?>[]{RetentionPreviewNotFoundException.class, RetentionPlan.Run.class});
        assertThat(jdbc.sql("SELECT count(*) FROM domain_event WHERE event_type = 'dataexchange.retention.run'")
                .query(Long.class).single()).as("the change log records a single run").isOne();
        assertThat(identity.personExists(formerMember)).isFalse();
    }

    @Test
    void givenAMembershipResumedWhileTheRunStarts_whenTheRunReachesThatPerson_thenItWaitsForTheChangeAndSkipsThem()
            throws Exception {
        // given
        UUID board = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        UUID admin = identity.createAccount(board, "admin", Set.of(Role.ADMIN));
        UUID returning = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        roster.assignMembership(returning, ACTIVE_TYPE, LocalDate.of(2018, 1, 1));
        jdbc.sql("UPDATE member SET ended_on = DATE '2023-06-30' WHERE person_id = :id")
                .param("id", returning).update();
        retention.setPolicy(RetentionCategory.FORMER_MEMBERS, 24);
        UUID previewId = retention.preview(admin).previewId();
        CountDownLatch resumed = new CountDownLatch(1);

        // when
        RetentionPlan.Run run;
        try (ExecutorService pool = Executors.newSingleThreadExecutor()) {
            Future<?> resuming = pool.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(status -> {
                jdbc.sql("UPDATE member SET ended_on = NULL WHERE person_id = :id").param("id", returning).update();
                resumed.countDown();
                try {
                    Thread.sleep(1500);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
            }));
            resumed.await();
            run = retention.run(previewId, admin);
            resuming.get();
        }

        // then
        assertThat(run.formerMembersSkipped()).as("the run waits for the resumed membership and skips it").isOne();
        assertThat(identity.personExists(returning)).as("a member who resumed is kept").isTrue();
    }

    @Test
    void givenAPeriodOutsideOneToTwelveHundredMonths_whenSetThroughTheService_thenItIsRefused() {
        // when / then
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> retention.setPolicy(RetentionCategory.BOOKINGS, 0))
                .isInstanceOf(RetentionPeriodInvalidException.class);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> retention.setPolicy(RetentionCategory.BOOKINGS, 1201))
                .isInstanceOf(RetentionPeriodInvalidException.class);
        assertThat(jdbc.sql("SELECT count(*) FROM retention_policy").query(Long.class).single()).isZero();
    }
}
