package org.courtside;

import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.Duration;
import java.util.Comparator;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public final class PostgresDiagnostics {

    private PostgresDiagnostics() {
    }

    public static String waitsAndLocks(JdbcClient jdbc) {
        return jdbc.sql("""
                        SELECT activity.pid, activity.state, activity.wait_event_type, activity.wait_event,
                               lock.locktype, lock.mode, lock.granted
                        FROM pg_stat_activity activity
                        LEFT JOIN pg_locks lock ON lock.pid = activity.pid
                        WHERE activity.datname = current_database()
                        ORDER BY activity.pid, lock.locktype, lock.mode
                        """)
                .query((result, row) -> "%s|%s|%s|%s|%s|%s|%s".formatted(
                        result.getInt("pid"), result.getString("state"),
                        result.getString("wait_event_type"), result.getString("wait_event"),
                        result.getString("locktype"), result.getString("mode"), result.getBoolean("granted")))
                .list()
                .toString();
    }

    public static <T> T await(Future<T> future, Duration timeout, JdbcClient jdbc, String operation)
            throws InterruptedException, ExecutionException {
        try {
            return future.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException failure) {
            future.cancel(true);
            throw new AssertionError(operation + " timed out after " + timeout
                    + ". PostgreSQL: " + waitsAndLocks(jdbc) + ". Threads: " + threadStates(), failure);
        }
    }

    private static String threadStates() {
        return Thread.getAllStackTraces().entrySet().stream()
                .sorted(Comparator.comparing(entry -> entry.getKey().getName()))
                .map(entry -> entry.getKey().getName() + "=" + entry.getKey().getState() + ":"
                        + java.util.Arrays.toString(entry.getValue()))
                .toList()
                .toString();
    }
}
