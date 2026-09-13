package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

@Service
@RequiredArgsConstructor
class PasswordResetMailLimit {

    private final JdbcClient jdbc;
    private final PasswordResetMailProperties properties;
    private final Clock clock;

    @Transactional
    boolean recordWithinWindow(UUID accountId) {
        lock(accountId);
        Instant now = clock.instant();
        Window current = currentWindow(accountId);
        boolean windowExpired = current == null
                || !current.startedAt().plus(properties.window()).isAfter(now);
        if (!windowExpired && current.mailedCount() >= properties.maxPerWindow()) {
            return false;
        }
        record(accountId, windowExpired ? 1 : current.mailedCount() + 1,
                windowExpired ? now : current.startedAt());
        return true;
    }

    @Transactional
    void deleteExpiredWindows() {
        jdbc.sql("DELETE FROM password_reset_mail_limit WHERE window_started_at < :cutoff")
                .param("cutoff", clock.instant().minus(properties.retention()).atOffset(ZoneOffset.UTC))
                .update();
    }

    private void lock(UUID accountId) {
        jdbc.sql("SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))) lock")
                .param("key", "PASSWORD_RESET_MAIL:" + accountId)
                .query(Long.class)
                .single();
    }

    private Window currentWindow(UUID accountId) {
        return jdbc.sql("""
                        SELECT mailed_count, window_started_at
                        FROM password_reset_mail_limit
                        WHERE account_id = :accountId
                        """)
                .param("accountId", accountId)
                .query((rs, row) -> new Window(rs.getInt("mailed_count"),
                        rs.getObject("window_started_at", OffsetDateTime.class).toInstant()))
                .optional()
                .orElse(null);
    }

    private void record(UUID accountId, int mailedCount, Instant windowStartedAt) {
        jdbc.sql("""
                        INSERT INTO password_reset_mail_limit
                            (account_id, mailed_count, window_started_at)
                        VALUES (:accountId, :mailedCount, :windowStartedAt)
                        ON CONFLICT (account_id) DO UPDATE
                        SET mailed_count = EXCLUDED.mailed_count,
                            window_started_at = EXCLUDED.window_started_at
                        """)
                .param("accountId", accountId)
                .param("mailedCount", mailedCount)
                .param("windowStartedAt", windowStartedAt.atOffset(ZoneOffset.UTC))
                .update();
    }

    private record Window(int mailedCount, Instant startedAt) {
    }
}
