package org.courtside.shared.web;

import jakarta.persistence.EntityManager;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.UserAccount;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.courtside.identity.UserAccountRepository;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

@TestPropertySource(properties = {
        "courtside.database.statement-timeout=2s",
        "courtside.database.request-transaction-timeout=2s"
})
class DatabaseDeadlineAnswerTest extends AbstractIntegrationTest {

    @Autowired
    private EntityManager entityManager;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @Autowired
    private SharedExceptionHandler handler;

    @Test
    void givenARequestTransactionPastItsDeadline_whenHibernateLoadsAnEntity_thenTheAnswerIsTheTypedTimeout() {
        // given
        Throwable failure = catchThrowable(() -> new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            jdbc.sql("SELECT pg_sleep(1)").query(Object.class).list();
            pause(1500);
            entityManager.find(UserAccount.class, UUID.randomUUID());
        }));

        // when
        ProblemDetail problem = handler.handleJpaFailure((RuntimeException) failure);

        // then
        assertThat(problem.getStatus()).as("Hibernate's own deadline answer is the same typed timeout, not a 500")
                .isEqualTo(HttpStatus.SERVICE_UNAVAILABLE.value());
        assertThat(problem.getType().toString()).isEqualTo("urn:courtside:error:transaction-timeout");
    }

    @Test
    void givenARequestTransactionPastItsDeadline_whenARepositoryLoadsAnEntity_thenTheAnswerIsTheTypedTimeout(
            @Autowired UserAccountRepository accounts) {
        // given
        Throwable failure = catchThrowable(() -> new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            jdbc.sql("SELECT pg_sleep(1)").query(Object.class).list();
            pause(1500);
            accounts.findById(UUID.randomUUID());
        }));

        // when
        ProblemDetail problem = handler.handleJpaFailure((RuntimeException) failure);

        // then
        assertThat(problem.getType().toString()).as("a translated deadline is still the typed timeout")
                .isEqualTo("urn:courtside:error:transaction-timeout");
    }

    @Test
    void givenAnotherPersistenceFailure_whenAnsweringIt_thenItStaysAnInternalError() {
        // when
        ProblemDetail problem = handler.handleJpaFailure(
                new org.springframework.orm.jpa.JpaSystemException(new IllegalStateException("broken mapping")));

        // then
        assertThat(problem.getStatus()).as("only the deadline is a 503; anything else is our bug")
                .isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR.value());
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
