package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SweepStatementTimeoutTest extends AbstractIntegrationTest {

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @Test
    void givenEveryIdentitySweep_whenItRuns_thenItsStatementsMayRunForTheMaintenanceTimeout(
            @Autowired LoginAttemptCleanup loginAttempts, @Autowired CredentialIssueLimit credentialIssues,
            @Autowired PasswordResetMailLimit resetMails, @Autowired PasswordResetTokenService resetTokens,
            @Autowired AgedSessionSweep sessions) {
        // given
        Map<String, Runnable> sweeps = new LinkedHashMap<>();
        sweeps.put("login attempts", loginAttempts::deleteExpiredAttempts);
        sweeps.put("credential issues", credentialIssues::deleteExpiredWindows);
        sweeps.put("reset mail windows", resetMails::deleteExpiredWindows);
        sweeps.put("reset tokens", resetTokens::deleteExpired);
        sweeps.put("aged sessions", sessions::deleteSessionsPastTheirLifetime);

        // when
        Map<String, String> timeouts = new LinkedHashMap<>();
        sweeps.forEach((name, sweep) -> new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            sweep.run();
            timeouts.put(name, jdbc.sql("SHOW statement_timeout").query(String.class).single());
        }));

        // then
        assertThat(timeouts).as("an accumulated backlog must not cancel the sweep that would clear it")
                .allSatisfy((name, timeout) -> assertThat(timeout).as(name).isEqualTo("10min"));
    }
}
