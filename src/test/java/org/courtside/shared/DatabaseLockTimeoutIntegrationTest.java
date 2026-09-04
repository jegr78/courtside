package org.courtside.shared;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PessimisticLockException;
import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.UncategorizedSQLException;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

@TestPropertySource(properties = {
        "courtside.database.lock-timeout=1s",
        "spring.datasource.hikari.connection-init-sql=SET statement_timeout TO 30000"
})
class DatabaseLockTimeoutIntegrationTest extends AbstractIntegrationTest {

    @Test
    void whenBorrowingAnApplicationConnection_thenPostgresBoundsEveryLockWait(
            @Autowired JdbcClient jdbc) {
        assertThat(jdbc.sql("SHOW lock_timeout").query(String.class).single()).isEqualTo("1s");
        assertThat(jdbc.sql("SHOW statement_timeout").query(String.class).single()).isEqualTo("30s");
    }

    @Test
    void whenAnotherTransactionOwnsARowLock_thenSpringReturnsTheTypedFailureWithinTheDatabaseBound(
            @Autowired DataSource dataSource, @Autowired JdbcClient jdbc) throws SQLException {
        UUID clubId = jdbc.sql("SELECT id FROM club_config LIMIT 1").query(UUID.class).single();

        try (var owner = dataSource.getConnection()) {
            owner.setAutoCommit(false);
            try (var statement = owner.prepareStatement("SELECT id FROM club_config WHERE id = ? FOR UPDATE")) {
                statement.setObject(1, clubId);
                statement.executeQuery();
            }

            Instant started = Instant.now();
            UncategorizedSQLException failure = catchThrowableOfType(
                    UncategorizedSQLException.class,
                    () -> jdbc.sql("SELECT id FROM club_config WHERE id = :id FOR UPDATE")
                            .param("id", clubId).query(UUID.class).single());

            assertThat(Duration.between(started, Instant.now())).isLessThan(Duration.ofSeconds(3));
            assertThat(failure).hasRootCauseInstanceOf(SQLException.class);
            assertThat(rootSqlException(failure).getSQLState()).isEqualTo("55P03");
            owner.rollback();
        }
    }

    @Test
    void whenJpaRequestsAContendedPessimisticLock_thenItsFailureUsesTheHandledPersistenceType(
            @Autowired DataSource dataSource, @Autowired JdbcClient jdbc,
            @Autowired EntityManager entityManager,
            @Autowired PlatformTransactionManager transactionManager) throws SQLException {
        UUID clubId = jdbc.sql("SELECT id FROM club_config LIMIT 1").query(UUID.class).single();

        try (var owner = dataSource.getConnection()) {
            owner.setAutoCommit(false);
            try (var statement = owner.prepareStatement("SELECT id FROM club_config WHERE id = ? FOR UPDATE")) {
                statement.setObject(1, clubId);
                statement.executeQuery();
            }

            PessimisticLockException failure = catchThrowableOfType(PessimisticLockException.class,
                    () -> new TransactionTemplate(transactionManager).executeWithoutResult(status ->
                            entityManager.createNativeQuery(
                                            "SELECT id FROM club_config WHERE id = :id FOR UPDATE")
                                    .setParameter("id", clubId)
                                    .getSingleResult()));

            assertThat(failure).hasRootCauseInstanceOf(SQLException.class);
            assertThat(rootSqlException(failure).getSQLState()).isEqualTo("55P03");
            owner.rollback();
        }
    }

    private static SQLException rootSqlException(Throwable failure) {
        Throwable cause = failure;
        while (cause.getCause() != null) {
            cause = cause.getCause();
        }
        return (SQLException) cause;
    }
}
