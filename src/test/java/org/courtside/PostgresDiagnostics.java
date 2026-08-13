package org.courtside;

import org.springframework.jdbc.core.simple.JdbcClient;

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
}
