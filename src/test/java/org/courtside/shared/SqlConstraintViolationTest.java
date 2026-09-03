package org.courtside.shared;

import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.Test;
import org.postgresql.util.PSQLException;
import org.postgresql.util.PSQLState;
import org.postgresql.util.ServerErrorMessage;
import org.springframework.dao.DataIntegrityViolationException;

import java.sql.SQLException;

import static org.assertj.core.api.Assertions.assertThat;

class SqlConstraintViolationTest {

    private static final String CONSTRAINT = "uq_example_name";

    @Test
    void givenTheExpectedStateAndConstraintName_whenMatching_thenItMatches() {
        DataIntegrityViolationException failure = failure("23505", CONSTRAINT);

        assertThat(SqlConstraintViolation.matches(
                failure, SqlConstraintViolation.UNIQUE_VIOLATION, CONSTRAINT)).isTrue();
    }

    @Test
    void givenTheExpectedNameButAnotherState_whenMatching_thenItDoesNotMatch() {
        DataIntegrityViolationException failure = failure("23514", CONSTRAINT);

        assertThat(SqlConstraintViolation.matches(
                failure, SqlConstraintViolation.UNIQUE_VIOLATION, CONSTRAINT)).isFalse();
    }

    @Test
    void givenTheExpectedStateButAnotherName_whenMatching_thenItDoesNotMatch() {
        DataIntegrityViolationException failure = failure("23505", "ck_example_name");

        assertThat(SqlConstraintViolation.matches(
                failure, SqlConstraintViolation.UNIQUE_VIOLATION, CONSTRAINT)).isFalse();
    }

    @Test
    void givenANonSqlCause_whenMatching_thenItDoesNotMatch() {
        DataIntegrityViolationException failure =
                new DataIntegrityViolationException("outer", new IllegalStateException(CONSTRAINT));

        assertThat(SqlConstraintViolation.matches(
                failure, SqlConstraintViolation.UNIQUE_VIOLATION, CONSTRAINT)).isFalse();
    }

    @Test
    void givenOnlyAnUnstructuredSqlMessage_whenMatching_thenItDoesNotMatch() {
        SQLException cause = new SQLException(
                "violates constraint " + CONSTRAINT, SqlConstraintViolation.UNIQUE_VIOLATION);
        DataIntegrityViolationException failure = new DataIntegrityViolationException("outer", cause);

        assertThat(SqlConstraintViolation.matches(
                failure, SqlConstraintViolation.UNIQUE_VIOLATION, CONSTRAINT)).isFalse();
    }

    @Test
    void givenAPostgresFailureWithoutServerFields_whenMatching_thenItDoesNotMatch() {
        PSQLException cause = new PSQLException("duplicate key", PSQLState.UNIQUE_VIOLATION);
        DataIntegrityViolationException failure = new DataIntegrityViolationException("outer", cause);

        assertThat(SqlConstraintViolation.matches(
                failure, SqlConstraintViolation.UNIQUE_VIOLATION, CONSTRAINT)).isFalse();
    }

    @Test
    void givenASqlCauseWithoutAMessage_whenMatchingStructuredFields_thenItMatches() {
        PSQLException cause = postgresFailure(
                SqlConstraintViolation.UNIQUE_VIOLATION, CONSTRAINT, null);
        ConstraintViolationException violation = new ConstraintViolationException(
                "could not execute statement", cause, "insert into example", null);
        DataIntegrityViolationException failure = new DataIntegrityViolationException(
                "outer", violation);

        assertThat(SqlConstraintViolation.matches(
                failure, SqlConstraintViolation.UNIQUE_VIOLATION, CONSTRAINT)).isTrue();
    }

    @Test
    void givenTheExpectedNameOnlyInARejectedValue_whenMatching_thenItDoesNotMatch() {
        PSQLException cause = postgresFailure(SqlConstraintViolation.UNIQUE_VIOLATION,
                "uq_another_name", "duplicate key: rejected value was " + CONSTRAINT);
        ConstraintViolationException violation = new ConstraintViolationException(
                "could not execute statement", cause, "insert into example", null);
        DataIntegrityViolationException failure = new DataIntegrityViolationException(
                "could not execute statement", violation);

        assertThat(SqlConstraintViolation.matches(
                failure, SqlConstraintViolation.UNIQUE_VIOLATION, CONSTRAINT)).isFalse();
    }

    private DataIntegrityViolationException failure(String sqlState, String constraint) {
        PSQLException cause = postgresFailure(sqlState, constraint, "violates a constraint");
        ConstraintViolationException violation = new ConstraintViolationException(
                "could not execute statement", cause, "insert into example", null);
        return new DataIntegrityViolationException("outer", violation);
    }

    private PSQLException postgresFailure(String sqlState, String constraint, String message) {
        String fields = "SERROR\0C" + sqlState + "\0n" + constraint + "\0";
        if (message != null) {
            fields += "M" + message + "\0";
        }
        return new PSQLException(new ServerErrorMessage(fields + "\0"));
    }
}
