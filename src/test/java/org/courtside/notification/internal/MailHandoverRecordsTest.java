package org.courtside.notification.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.notification.MailHandover;
import org.courtside.notification.MessageKind;
import org.courtside.notification.testfixture.NotificationTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import({IdentityTestFixture.class, NotificationTestFixture.class})
class MailHandoverRecordsTest extends AbstractIntegrationTest {

    private static final Instant EARLIER = Instant.parse("2026-05-12T08:00:00Z");

    @Autowired
    private MailHandover handover;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private NotificationTestFixture notifications;

    private UUID account;

    @BeforeEach
    void setUp() {
        UUID person = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        account = identity.createEnabledAccount(person, "jane.doe", Set.of(Role.MEMBER));
    }

    @Test
    void givenNoSettledMessage_whenObserved_thenNothingIsClaimed() {
        // when
        MailHandover.Observation observed = handover.observe();

        // then
        assertThat(observed.lastHandedOverAt()).isEmpty();
        assertThat(observed.lastFailedAt()).isEmpty();
        assertThat(observed.retrying()).isFalse();
        assertThat(observed.relay()).isEqualTo("localhost:2525");
    }

    @Test
    void givenAHandoverThenAFailure_whenObserved_thenTheNewestOfEachIsReported() {
        // given
        notifications.recordHandedOver(account, MessageKind.ACCOUNT_WELCOME, "<a@example.org>", EARLIER);
        notifications.recordHandedOver(account, MessageKind.ACCOUNT_WELCOME, "<b@example.org>",
                EARLIER.plus(Duration.ofMinutes(10)));
        notifications.recordFailed(account, MessageKind.ACCOUNT_WELCOME, "<c@example.org>",
                EARLIER.plus(Duration.ofMinutes(20)));

        // when
        MailHandover.Observation observed = handover.observe();

        // then
        assertThat(observed.lastHandedOverAt()).contains(EARLIER.plus(Duration.ofMinutes(10)));
        assertThat(observed.lastFailedAt()).contains(EARLIER.plus(Duration.ofMinutes(20)));
        assertThat(observed.retrying()).as("no queued message waits for another attempt").isFalse();
    }

    @Test
    void givenAQueuedMessageAfterAFailedAttempt_whenObserved_thenItIsRetrying() {
        // given
        notifications.queueRetry(account, MessageKind.ACCOUNT_WELCOME, "<d@example.org>", EARLIER,
                EARLIER.plus(Duration.ofDays(365)));

        // when / then
        assertThat(handover.observe().retrying()).isTrue();
    }
}
