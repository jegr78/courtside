package org.courtside.shared;

import org.postgresql.util.PSQLException;
import org.postgresql.util.ServerErrorMessage;
import org.springframework.dao.DataIntegrityViolationException;

public final class SqlConstraintViolation {

    public static final String FOREIGN_KEY_VIOLATION = "23503";
    public static final String UNIQUE_VIOLATION = "23505";
    public static final String EXCLUSION_VIOLATION = "23P01";

    private SqlConstraintViolation() {
    }

    public static boolean matches(DataIntegrityViolationException failure, String sqlState,
                                  String constraint) {
        Throwable cause = failure;
        while (cause != null) {
            if (cause instanceof PSQLException postgresFailure) {
                ServerErrorMessage serverError = postgresFailure.getServerErrorMessage();
                return sqlState.equals(postgresFailure.getSQLState())
                        && serverError != null
                        && constraint.equals(serverError.getConstraint());
            }
            cause = cause.getCause();
        }
        return false;
    }
}
