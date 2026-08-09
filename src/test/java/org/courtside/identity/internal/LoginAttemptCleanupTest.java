package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import static org.assertj.core.api.Assertions.assertThat;

class LoginAttemptCleanupTest extends AbstractIntegrationTest {

    @Autowired
    private LoginAttemptCleanup cleanup;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenExpiredAndCurrentAttempts_whenCleanupRuns_thenOnlyExpiredAttemptsAreDeleted() {
        // given
        insertAttempt("a".repeat(64), "2026-05-12 08:00:00Z");
        insertAttempt("b".repeat(64), "2026-05-12 10:00:00Z");

        // when
        cleanup.deleteExpiredAttempts();

        // then
        assertThat(jdbc.sql("SELECT subject_hash FROM login_attempt_limit")
                .query(String.class).list()).containsExactly("b".repeat(64));
    }

    private void insertAttempt(String subjectHash, String windowStartedAt) {
        jdbc.sql("""
                        INSERT INTO login_attempt_limit
                            (scope, subject_hash, attempt_count, window_started_at)
                        VALUES ('ADDRESS', :subjectHash, 1, CAST(:windowStartedAt AS timestamptz))
                        """)
                .param("subjectHash", subjectHash)
                .param("windowStartedAt", windowStartedAt)
                .update();
    }
}
