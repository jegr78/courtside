package org.courtside.dataexchange.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import static org.assertj.core.api.Assertions.assertThat;

class PreviewSweepStatementTimeoutTest extends AbstractIntegrationTest {

    @Test
    void givenThePreviewSweep_whenItRuns_thenItsStatementsMayRunForTheMaintenanceTimeout(
            @Autowired PreviewExpiry expiry, @Autowired JdbcClient jdbc,
            @Autowired PlatformTransactionManager transactionManager) {
        // when
        String timeout = new TransactionTemplate(transactionManager).execute(status -> {
            expiry.sweepNow();
            return jdbc.sql("SHOW statement_timeout").query(String.class).single();
        });

        // then
        assertThat(timeout).as("an accumulated backlog must not cancel the sweep that would clear it")
                .isEqualTo("10min");
    }
}
