package org.courtside.access.internal;

import lombok.extern.slf4j.Slf4j;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Optional;

/** The session-level advisory lock that lets one instance at a time run an access pass. */
@Slf4j
final class PassLock implements AutoCloseable {

    static final long KEY = 1136;
    private static final int CHECK_TIMEOUT_MILLISECONDS = 2000;

    private final Connection connection;

    private PassLock(Connection connection) {
        this.connection = connection;
    }

    static Optional<PassLock> tryAcquire(DataSource dataSource) {
        Connection connection;
        try {
            connection = dataSource.getConnection();
        } catch (SQLException unavailable) {
            return Optional.empty();
        }
        try {
            connection.setAutoCommit(true);
            if (answers(connection, "SELECT pg_try_advisory_lock(" + KEY + ")")) {
                return Optional.of(new PassLock(connection));
            }
        } catch (SQLException failed) {
            closeQuietly(connection);
            return Optional.empty();
        }
        closeQuietly(connection);
        return Optional.empty();
    }

    boolean stillHeld() {
        try {
            connection.setNetworkTimeout(Runnable::run, CHECK_TIMEOUT_MILLISECONDS);
            return answers(connection, """
                    SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0
                                   AND objid = %d AND objsubid = 1 AND granted AND pid = pg_backend_pid())
                    """.formatted(KEY));
        } catch (SQLException lost) {
            return false;
        }
    }

    @Override
    public void close() {
        try {
            answers(connection, "SELECT pg_advisory_unlock(" + KEY + ")");
        } catch (SQLException lost) {
            closeQuietly(connection);
            return;
        }
        closeQuietly(connection);
    }

    private static boolean answers(Connection connection, String query) throws SQLException {
        try (Statement statement = connection.createStatement(); ResultSet result = statement.executeQuery(query)) {
            return result.next() && result.getBoolean(1);
        }
    }

    private static void closeQuietly(Connection connection) {
        try {
            connection.close();
        } catch (SQLException alreadyGone) {
            log.debug("The access pass lock's connection could not be closed", alreadyGone);
        }
    }
}
