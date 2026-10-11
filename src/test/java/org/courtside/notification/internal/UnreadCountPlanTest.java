package org.courtside.notification.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class UnreadCountPlanTest extends AbstractIntegrationTest {

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private TransactionTemplate transactions;

    @Test
    void whenTheCentreCountsAnAccountsUnreadEntries_thenThePlannerReadsTheUnreadIndex() {
        // when
        String plan = transactions.execute(status -> {
            jdbc.sql("SET LOCAL enable_seqscan = off").update();
            return String.join("\n", jdbc.sql("EXPLAIN " + OwnNotifications.UNREAD_COUNT)
                    .param("accountId", UUID.randomUUID())
                    .query(String.class)
                    .list());
        });

        // then
        assertThat(plan).as("the production count reads only the unread entries of one account")
                .contains("notification_unread_idx");
    }
}
