package org.courtside.notification.internal;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.notification.MessageKind;
import org.courtside.notification.MessageStatistics;
import org.courtside.shared.UsernameReminderRequested;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Import;
import org.springframework.core.task.TaskExecutor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@Import(IdentityTestFixture.class)
class MailOutboxTest extends AbstractIntegrationTest {

    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");

    @MockitoSpyBean
    private JavaMailSender sender;

    @MockitoSpyBean
    private MessageRecordRepository records;

    @MockitoBean(name = "mailOutboxExecutor")
    private TaskExecutor executor;

    @Autowired
    private MailOutbox outbox;

    @Autowired
    private ApplicationEventPublisher events;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private TransactionTemplate transactions;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private MessageStatistics statistics;

    private ThreadPoolTaskExecutor productionPool;

    @AfterEach
    void stopTheProductionPool() {
        if (productionPool != null) {
            productionPool.shutdown();
        }
    }

    @Test
    void givenARelayThatHoldsEveryMessage_whenEventsArePublished_thenThePublisherReturnsWithTheMessagesQueued() {
        // given
        runWakeUpsOnTheProductionPool();
        CountDownLatch relayAnswers = new CountDownLatch(1);
        List<String> handingOverThreads = new CopyOnWriteArrayList<>();
        doAnswer(invocation -> {
            handingOverThreads.add(Thread.currentThread().getName());
            relayAnswers.await(30, TimeUnit.SECONDS);
            return null;
        }).when(sender).send(any(MimeMessage.class));
        List<UUID> accountIds = new ArrayList<>();
        for (int member = 0; member < 6; member++) {
            accountIds.add(member("member" + member));
        }
        String publishingThread = Thread.currentThread().getName();

        // when — more messages than two workers and one pending pass can hold
        accountIds.forEach(accountId -> transactions.executeWithoutResult(status ->
                events.publishEvent(new UsernameReminderRequested(accountId))));

        // then — had the publisher handed one over itself, it would still be waiting on the relay
        assertThat(states(accountIds))
                .as("the publisher returns while the relay holds every message, so none was its own work")
                .containsOnly("QUEUED");
        relayAnswers.countDown();
        await().atMost(Duration.ofSeconds(30)).untilAsserted(() -> assertThat(states(accountIds))
                .as("a wake-up the saturated pool discarded still reaches its row")
                .containsOnly("HANDED_OVER"));
        assertThat(handingOverThreads)
                .as("no message is handed over on the thread that published its event")
                .doesNotContain(publishingThread)
                .allSatisfy(thread -> assertThat(thread).startsWith("mail-outbox-"));
    }

    @Test
    void givenRowsAStoppedInstanceLeftQueued_whenThePassRuns_thenTheyAreHandedOverUnderTheirOwnIds()
            throws MessagingException {
        // given — nothing in memory knows about them, only the table does
        UUID accountId = member("resumed");
        String messageId = "<left-queued@example.org>";
        queuedRow(accountId, MessageKind.ACCOUNT_USERNAME_REMINDER, messageId, "{}");

        // when
        outbox.deliverDue();

        // then
        org.mockito.ArgumentCaptor<MimeMessage> sent = org.mockito.ArgumentCaptor.forClass(MimeMessage.class);
        verify(sender).send(sent.capture());
        assertThat(sent.getValue().getHeader("Message-ID")).containsExactly(messageId);
        assertThat(states(List.of(accountId))).containsExactly("HANDED_OVER");
    }

    @Test
    void givenTwoPassesRunningAtOnce_whenTheyDrainTheSameRows_thenEveryMessageIsHandedOverExactlyOnce()
            throws Exception {
        // given
        List<String> sentIds = new CopyOnWriteArrayList<>();
        doAnswer(invocation -> {
            sentIds.add(((MimeMessage) invocation.getArgument(0)).getHeader("Message-ID")[0]);
            Thread.sleep(50);
            return null;
        }).when(sender).send(any(MimeMessage.class));
        List<UUID> accountIds = new ArrayList<>();
        for (int member = 0; member < 8; member++) {
            UUID accountId = member("parallel" + member);
            accountIds.add(accountId);
            queuedRow(accountId, MessageKind.ACCOUNT_USERNAME_REMINDER, "<parallel-" + member + "@example.org>", "{}");
        }
        ExecutorService passes = Executors.newFixedThreadPool(3);

        // when
        try {
            List<Future<?>> running = new ArrayList<>();
            for (int pass = 0; pass < 3; pass++) {
                running.add(passes.submit(outbox::deliverDue));
            }
            for (Future<?> pass : running) {
                pass.get(30, TimeUnit.SECONDS);
            }
        } finally {
            passes.shutdownNow();
        }
        outbox.deliverDue();

        // then
        assertThat(sentIds).as("a claimed row is skipped by every other pass, so nothing goes out twice")
                .hasSize(8)
                .doesNotHaveDuplicates();
        assertThat(states(accountIds)).containsOnly("HANDED_OVER");
    }

    @Test
    void givenARelayThatStaysAway_whenTheRetriesComeDue_thenTheyAreSpacedBoundedAndCounted() {
        // given
        doThrow(new MailSendException("nothing is listening")).when(sender).send(any(MimeMessage.class));
        UUID accountId = member("away");
        UUID recordId = queuedRow(accountId, MessageKind.ACCOUNT_USERNAME_REMINDER, "<away@example.org>", "{}");
        List<Duration> gaps = new ArrayList<>();

        // when
        for (int pass = 0; pass < MailOutbox.ATTEMPTS + 2; pass++) {
            outbox.deliverDue();
            Instant next = nextAttempt(recordId);
            if (next != null) {
                gaps.add(Duration.between(NOW, next));
                outbox.deliverDue();
                dueNow(recordId);
            }
        }

        // then
        verify(sender, times(MailOutbox.ATTEMPTS)).send(any(MimeMessage.class));
        assertThat(gaps)
                .as("a retry waits for its gap, and the gaps outlast a relay that is down for minutes")
                .containsExactly(Duration.ofSeconds(15), Duration.ofSeconds(45), Duration.ofSeconds(135),
                        Duration.ofSeconds(405), Duration.ofSeconds(1215));
        assertThat(states(List.of(accountId))).containsExactly("FAILED");
        assertThat(jdbc.sql("SELECT reason FROM message_record WHERE id = :id").param("id", recordId)
                .query(String.class).single())
                .as("a message given up on says why").isNotBlank();
        MessageStatistics.KindCount counted = statistics.queuedBetween(LocalDate.of(2026, 5, 12),
                        LocalDate.of(2026, 5, 12)).stream()
                .filter(kind -> kind.kind() == MessageKind.ACCOUNT_USERNAME_REMINDER)
                .findFirst().orElseThrow();
        assertThat(counted.failed()).isEqualTo(1);
        assertThat(counted.retried()).as("the statistics show that the message was tried again").isEqualTo(1);
    }

    @Test
    void givenABookingThatIsGone_whenItsMessageComesDue_thenTheRowFailsWithItsReasonAndNothingIsSent() {
        // given
        UUID accountId = member("gone");
        UUID recordId = queuedRow(accountId, MessageKind.BOOKING_CONFIRMED, "<gone@example.org>",
                "{\"bookingId\": \"" + UUID.randomUUID() + "\"}");

        // when
        outbox.deliverDue();

        // then
        verify(sender, never()).send(any(MimeMessage.class));
        assertThat(states(List.of(accountId))).containsExactly("FAILED");
        assertThat(jdbc.sql("SELECT reason FROM message_record WHERE id = :id").param("id", recordId)
                .query(String.class).single())
                .as("a message that cannot be written is retained with the reason, not dropped")
                .isEqualTo("BookingGone");
    }

    @Test
    void givenAQueuedRowThatIsNotYetDue_whenThePassRuns_thenItIsLeftForItsTime() {
        // given
        UUID accountId = member("later");
        UUID recordId = queuedRow(accountId, MessageKind.ACCOUNT_USERNAME_REMINDER, "<later@example.org>", "{}");
        jdbc.sql("UPDATE message_record SET next_attempt_at = :at WHERE id = :id")
                .param("at", java.sql.Timestamp.from(NOW.plusSeconds(5))).param("id", recordId).update();

        // when
        outbox.deliverDue();

        // then
        verify(sender, never()).send(any(MimeMessage.class));
        assertThat(states(List.of(accountId))).containsExactly("QUEUED");
    }

    @Test
    void givenARowWhoseLeaseRanOut_whenThePassRuns_thenItIsTakenOverWithoutCountingAsARetry() {
        // given — a pass that claimed it died: one attempt counted, its lease already over
        UUID accountId = member("takenover");
        UUID recordId = queuedRow(accountId, MessageKind.ACCOUNT_USERNAME_REMINDER, "<takenover@example.org>", "{}");
        jdbc.sql("UPDATE message_record SET attempts = 1, next_attempt_at = :at WHERE id = :id")
                .param("at", java.sql.Timestamp.from(NOW.minusSeconds(1))).param("id", recordId).update();

        // when
        outbox.deliverDue();

        // then
        verify(sender, times(1)).send(any(MimeMessage.class));
        assertThat(states(List.of(accountId))).containsExactly("HANDED_OVER");
        assertThat(jdbc.sql("SELECT retries FROM message_record WHERE id = :id").param("id", recordId)
                .query(Integer.class).single())
                .as("a pass that died is not a failed handover").isZero();
    }

    @Test
    void givenAPassThatWasOvertakenAfterItsClaim_whenItReachesTheRow_thenItNeitherSendsNorWrites() {
        // given — between this pass's claim and its handover another pass has taken the row over
        UUID accountId = member("overtaken");
        UUID recordId = queuedRow(accountId, MessageKind.ACCOUNT_USERNAME_REMINDER, "<overtaken@example.org>", "{}");
        doAnswer(invocation -> {
            jdbc.sql("UPDATE message_record SET attempts = attempts + 1 WHERE id = :id")
                    .param("id", recordId).update();
            return invocation.callRealMethod();
        }).when(records).lockById(recordId);

        // when
        outbox.deliverDue();

        // then
        verify(sender, never()).send(any(MimeMessage.class));
        assertThat(states(List.of(accountId)))
                .as("only the pass holding the current attempt hands over and writes the outcome")
                .containsExactly("QUEUED");
    }

    @Test
    void givenARowThatUsedUpItsAttemptsInPassesThatDied_whenItIsClaimed_thenItFailsWithoutAnotherSend() {
        // given
        UUID accountId = member("exhausted");
        UUID recordId = queuedRow(accountId, MessageKind.ACCOUNT_USERNAME_REMINDER, "<exhausted@example.org>", "{}");
        jdbc.sql("UPDATE message_record SET attempts = :attempts WHERE id = :id")
                .param("attempts", MailOutbox.ATTEMPTS).param("id", recordId).update();

        // when
        outbox.deliverDue();

        // then
        verify(sender, never()).send(any(MimeMessage.class));
        assertThat(states(List.of(accountId))).containsExactly("FAILED");
        assertThat(jdbc.sql("SELECT reason FROM message_record WHERE id = :id").param("id", recordId)
                .query(String.class).single())
                .as("a row that keeps killing its pass cannot be claimed forever").isEqualTo("AttemptsExhausted");
    }

    @Test
    void givenABookingMessageQueuedBeforeACredential_whenThePassRuns_thenTheCredentialGoesFirst() {
        // given
        UUID accountId = member("urgent");
        UUID booking = queuedRow(accountId, MessageKind.BOOKING_CONFIRMED, "<earlier@example.org>",
                "{\"bookingId\": \"" + UUID.randomUUID() + "\"}");
        UUID credential = queuedRow(accountId, MessageKind.ACCOUNT_USERNAME_REMINDER, "<later@example.org>", "{}");
        org.mockito.InOrder order = org.mockito.Mockito.inOrder(records);

        // when
        outbox.deliverDue();

        // then — somebody waiting at the sign-in page is served before a busy evening
        order.verify(records).lockById(credential);
        order.verify(records, org.mockito.Mockito.atLeastOnce()).lockById(booking);
    }

    private void runWakeUpsOnTheProductionPool() {
        productionPool = (ThreadPoolTaskExecutor) new NotificationConfiguration().mailOutboxExecutor();
        doAnswer(invocation -> {
            productionPool.execute(invocation.getArgument(0));
            return null;
        }).when(executor).execute(any(Runnable.class));
    }

    private UUID member(String name) {
        UUID personId = identity.createPerson("Jane", "Doe", "jane.doe." + name + "@example.org");
        return identity.createEnabledAccount(personId, "doe.jane." + name, Set.of(Role.MEMBER));
    }

    private UUID queuedRow(UUID accountId, MessageKind kind, String messageId, String parameters) {
        UUID id = UUID.randomUUID();
        jdbc.sql("""
                        INSERT INTO message_record (id, account_id, kind, state, message_id, queued_at,
                                                    next_attempt_at, parameters)
                        VALUES (:id, :accountId, :kind, 'QUEUED', :messageId, :at, :at, CAST(:parameters AS jsonb))
                        """)
                .param("id", id)
                .param("accountId", accountId)
                .param("kind", kind.name())
                .param("messageId", messageId)
                .param("at", java.sql.Timestamp.from(NOW))
                .param("parameters", parameters)
                .update();
        return id;
    }

    private Instant nextAttempt(UUID recordId) {
        return jdbc.sql("SELECT next_attempt_at FROM message_record WHERE id = :id").param("id", recordId)
                .query(java.sql.Timestamp.class).optional().map(java.sql.Timestamp::toInstant).orElse(null);
    }

    private void dueNow(UUID recordId) {
        jdbc.sql("UPDATE message_record SET next_attempt_at = queued_at WHERE id = :id AND state = 'QUEUED'")
                .param("id", recordId).update();
    }

    private List<String> states(List<UUID> accountIds) {
        return accountIds.stream()
                .flatMap(accountId -> jdbc.sql("SELECT state FROM message_record WHERE account_id = :id")
                        .param("id", accountId).query(String.class).list().stream())
                .toList();
    }
}
