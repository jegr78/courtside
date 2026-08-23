package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

// The account is the unit because the account is what the abuse targets: a mailbox filled with
// credentials for one member. A board issuing twice in a row is nowhere near the limit.
@Service
@RequiredArgsConstructor
class CredentialIssueLimit implements CredentialIssuing {

    private final JdbcClient jdbc;
    private final CredentialIssueProperties properties;
    private final Clock clock;

    @Override
    @Transactional
    public void registerOrRefuse(UUID accountId) {
        lock(accountId);
        Instant now = clock.instant();
        Window current = currentWindow(accountId);
        boolean windowExpired = current == null
                || !current.startedAt().plus(properties.window()).isAfter(now);
        if (!windowExpired && current.issuedCount() >= properties.maxPerWindow()) {
            throw new CredentialIssueRateLimitedException(properties.maxPerWindow());
        }
        record(accountId, windowExpired ? 1 : current.issuedCount() + 1,
                windowExpired ? now : current.startedAt());
    }

    @Scheduled(initialDelayString = "PT1H", fixedDelayString = "PT1H")
    @Transactional
    void deleteExpiredWindows() {
        jdbc.sql("DELETE FROM credential_issue_limit WHERE window_started_at < :cutoff")
                .param("cutoff", clock.instant().minus(properties.retention()).atOffset(ZoneOffset.UTC))
                .update();
    }

    private void lock(UUID accountId) {
        jdbc.sql("SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))) lock")
                .param("key", "CREDENTIAL_ISSUE:" + accountId)
                .query(Long.class)
                .single();
    }

    private Window currentWindow(UUID accountId) {
        return jdbc.sql("""
                        SELECT issued_count, window_started_at
                        FROM credential_issue_limit
                        WHERE account_id = :accountId
                        """)
                .param("accountId", accountId)
                .query((rs, row) -> new Window(rs.getInt("issued_count"),
                        rs.getObject("window_started_at", OffsetDateTime.class).toInstant()))
                .optional()
                .orElse(null);
    }

    private void record(UUID accountId, int issuedCount, Instant windowStartedAt) {
        jdbc.sql("""
                        INSERT INTO credential_issue_limit
                            (account_id, issued_count, window_started_at)
                        VALUES (:accountId, :issuedCount, :windowStartedAt)
                        ON CONFLICT (account_id) DO UPDATE
                        SET issued_count = EXCLUDED.issued_count,
                            window_started_at = EXCLUDED.window_started_at
                        """)
                .param("accountId", accountId)
                .param("issuedCount", issuedCount)
                .param("windowStartedAt", windowStartedAt.atOffset(ZoneOffset.UTC))
                .update();
    }

    private record Window(int issuedCount, Instant startedAt) {
    }
}
