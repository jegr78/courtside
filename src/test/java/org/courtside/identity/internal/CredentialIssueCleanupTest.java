package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.Clock;
import java.time.Duration;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class CredentialIssueCleanupTest extends AbstractIntegrationTest {

    @Autowired
    private CredentialIssueLimit limit;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private Clock clock;

    @Test
    void givenWindowsOnBothSidesOfTheRetention_whenTheCleanupRuns_thenOnlyTheOutlivedOneIsGone() {
        // given
        UUID outlived = accountWithWindowStarted(Duration.ofHours(48));
        UUID recent = accountWithWindowStarted(Duration.ofHours(2));

        // when
        limit.deleteExpiredWindows();

        // then — a row still inside its retention carries a count that must keep binding
        assertThat(countedFor(outlived)).isZero();
        assertThat(countedFor(recent)).isOne();
    }

    private UUID accountWithWindowStarted(Duration ago) {
        UUID accountId = UUID.randomUUID();
        jdbc.sql("""
                        INSERT INTO person (id, first_name, last_name, email)
                        VALUES (:id, 'Jane', 'Doe', :email)
                        """)
                .param("id", accountId).param("email", accountId + "@example.org").update();
        jdbc.sql("""
                        INSERT INTO user_account (id, person_id, username, locale, enabled,
                            password_change_required)
                        VALUES (:id, :id, :username, 'de', true, true)
                        """)
                .param("id", accountId).param("username", "doe." + accountId).update();
        jdbc.sql("""
                        INSERT INTO credential_issue_limit (account_id, issued_count, window_started_at)
                        VALUES (:id, 1, :startedAt)
                        """)
                .param("id", accountId)
                .param("startedAt", clock.instant().minus(ago).atOffset(ZoneOffset.UTC))
                .update();
        return accountId;
    }

    private int countedFor(UUID accountId) {
        return jdbc.sql("SELECT count(*) FROM credential_issue_limit WHERE account_id = :id")
                .param("id", accountId).query(Integer.class).single();
    }
}
