package org.courtside.notification.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.notification.MessageKind;
import org.courtside.notification.testfixture.NotificationTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class ReadNotificationExpiryTest extends AbstractIntegrationTest {

    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");

    @Autowired
    private ReadNotificationExpiry expiry;

    @Autowired
    private NotificationTestFixture notifications;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private ConfigTestFixture config;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private PlatformTransactionManager transactions;

    private UUID account;

    @BeforeEach
    void aMember() {
        UUID person = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        account = identity.createEnabledAccount(person, "doe.jane", Set.of(Role.MEMBER));
    }

    @Test
    void givenTheDefaultPeriod_whenTheJobRuns_thenOnlyAReadEntryReadLongerAgoIsGone() {
        // given
        UUID readLongAgo = readEntry(daysAgo(91), daysAgo(91));
        UUID readRecently = readEntry(daysAgo(400), daysAgo(89));
        UUID unreadOfTheSameAge = notifications.notify(account, MessageKind.BOOKING_REMINDER, null, daysAgo(400));

        // when
        expiry.deleteExpired();

        // then
        assertThat(notifications.ids(account))
                .as("an unread entry never expires, and a read one counts from when it was read")
                .containsExactlyInAnyOrder(readRecently, unreadOfTheSameAge)
                .doesNotContain(readLongAgo);
    }

    @Test
    void givenAShorterPeriodSetByTheClub_whenTheJobRuns_thenItAppliesFromThatRun() {
        // given
        UUID readFortyDaysAgo = readEntry(daysAgo(50), daysAgo(40));
        UUID readTwentyDaysAgo = readEntry(daysAgo(50), daysAgo(20));
        config.keepReadNotificationsFor(30);

        // when
        expiry.deleteExpired();

        // then
        assertThat(notifications.ids(account)).containsExactly(readTwentyDaysAgo).doesNotContain(readFortyDaysAgo);
    }

    @Test
    void whenTheJobRuns_thenItsStatementMayRunForTheMaintenanceTimeout() {
        // when
        String timeout = new TransactionTemplate(transactions).execute(status -> {
            expiry.deleteExpired();
            return jdbc.sql("SHOW statement_timeout").query(String.class).single();
        });

        // then
        assertThat(timeout).as("an accumulated backlog must not cancel the run that clears it").isEqualTo("10min");
    }

    private UUID readEntry(Instant createdAt, Instant readAt) {
        UUID id = notifications.notify(account, MessageKind.BOOKING_REMINDER, null, createdAt);
        notifications.markRead(id, readAt);
        return id;
    }

    private static Instant daysAgo(int days) {
        return NOW.minus(Duration.ofDays(days));
    }
}
