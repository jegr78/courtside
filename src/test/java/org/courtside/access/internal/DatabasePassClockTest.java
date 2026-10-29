package org.courtside.access.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.OffsetDateTime;

import static org.assertj.core.api.Assertions.assertThat;

class DatabasePassClockTest extends AbstractIntegrationTest {

    @Autowired
    private DatabasePassClock clock;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private PlatformTransactionManager transactions;

    @Test
    void givenATransactionThatHasRunForAWhile_whenTheClockIsRead_thenItAnswersTheStatementsTimeNotTheTransactions() {
        // given
        Instant[] read = new Instant[2];
        new TransactionTemplate(transactions).executeWithoutResult(status -> {
            read[0] = jdbc.sql("SELECT transaction_timestamp()").query(OffsetDateTime.class).single().toInstant();
            jdbc.sql("SELECT pg_sleep(0.05)").query().singleValue();

            // when
            read[1] = clock.now();
        });

        // then
        assertThat(read[1])
                .as("a row transaction compares against the moment it reads the clock, not when it began")
                .isAfterOrEqualTo(read[0].plusMillis(50));
    }
}
