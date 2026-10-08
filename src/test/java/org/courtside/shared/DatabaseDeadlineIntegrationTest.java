package org.courtside.shared;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionTimedOutException;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.catchThrowable;

@TestPropertySource(properties = {
        "courtside.database.statement-timeout=1s",
        "courtside.database.request-transaction-timeout=1s"
})
class DatabaseDeadlineIntegrationTest extends AbstractIntegrationTest {

    private static final String PROBE = "a".repeat(64);

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @AfterEach
    void leaveTheRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    private void insertProbe() {
        jdbc.sql("""
                        INSERT INTO login_attempt_limit (scope, subject_hash, attempt_count, window_started_at)
                        VALUES ('ADDRESS', :hash, 1, now())
                        """).param("hash", PROBE).update();
    }

    private long probes() {
        return jdbc.sql("SELECT count(*) FROM login_attempt_limit WHERE subject_hash = :hash")
                .param("hash", PROBE).query(Long.class).single();
    }

    private static void insideARequest() {
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
    }

    @Test
    void givenAStatementLongerThanTheStatementTimeout_whenItRuns_thenPostgresCancelsItAndTheTransactionRollsBack() {
        // given
        RequestContextHolder.resetRequestAttributes();

        // when
        Throwable failure = catchThrowable(() -> new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            insertProbe();
            jdbc.sql("SELECT pg_sleep(3)").query(Object.class).list();
        }));

        // then
        assertThat(failure).as("the database bounds every statement").isInstanceOf(QueryTimeoutException.class);
        assertThat(probes()).as("nothing the cancelled transaction wrote survives").isZero();
    }

    @Test
    void givenARequestTransactionPastItsDeadline_whenItRunsAnotherStatement_thenItFailsAndRollsBack() {
        // given
        insideARequest();

        // when
        Throwable failure = catchThrowable(() -> new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            insertProbe();
            jdbc.sql("SELECT pg_sleep(0.8)").query(Object.class).list();
            pause(400);
            jdbc.sql("SELECT 1").query(Integer.class).single();
        }));

        // then
        assertThat(failure).as("a request transaction ends at its deadline, not at its last statement's")
                .isInstanceOfAny(TransactionTimedOutException.class, QueryTimeoutException.class);
        assertThat(probes()).as("nothing the expired transaction wrote survives").isZero();
    }

    @Test
    void givenTheSameTransactionOutsideARequest_whenItRunsPastTheRequestDeadline_thenItCompletes() {
        // given
        RequestContextHolder.resetRequestAttributes();

        // when / then
        assertThatCode(() -> new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            insertProbe();
            jdbc.sql("SELECT pg_sleep(0.8)").query(Object.class).list();
            pause(400);
            jdbc.sql("SELECT 1").query(Integer.class).single();
        })).as("scheduled and startup work is not held to a request's deadline").doesNotThrowAnyException();
        assertThat(probes()).isEqualTo(1);
    }

    @Test
    void givenARequestTransactionThatDeclaresALongerTimeout_whenItRunsPastTheDefault_thenItCompletes() {
        // given
        insideARequest();
        TransactionTemplate declared = new TransactionTemplate(transactionManager);
        declared.setTimeout(10);

        // when / then
        assertThatCode(() -> declared.executeWithoutResult(status -> {
            jdbc.sql("SELECT pg_sleep(0.8)").query(Object.class).list();
            pause(400);
            jdbc.sql("SELECT 1").query(Integer.class).single();
        })).as("a path that states a longer deadline keeps it").doesNotThrowAnyException();
    }

    private static void pause(long milliseconds) {
        try {
            Thread.sleep(milliseconds);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(interrupted);
        }
    }
}
