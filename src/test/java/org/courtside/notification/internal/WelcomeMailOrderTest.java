package org.courtside.notification.internal;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.notification.MessageKind;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.core.task.TaskExecutor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.sql.Timestamp;
import java.time.Instant;
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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;

@Import(IdentityTestFixture.class)
class WelcomeMailOrderTest extends AbstractIntegrationTest {

    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");

    @MockitoSpyBean
    private JavaMailSender sender;

    @MockitoBean(name = "mailOutboxExecutor")
    private TaskExecutor executor;

    @Autowired
    private MailOutbox outbox;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenAWelcomeAndAFirstPassword_whenTwoPassesRunAtOnce_thenThePasswordWaitsUntilTheWelcomeIsHandedOver()
            throws Exception {
        // given
        UUID accountId = aNewAccount();
        queued(accountId, MessageKind.ACCOUNT_WELCOME);
        queued(accountId, MessageKind.CREDENTIALS_NEW_ACCOUNT);
        CountDownLatch welcomeIsSending = new CountDownLatch(1);
        CountDownLatch relayAnswers = new CountDownLatch(1);
        List<String> mailed = new CopyOnWriteArrayList<>();
        doAnswer(invocation -> {
            mailed.add(((MimeMessage) invocation.getArgument(0)).getSubject());
            welcomeIsSending.countDown();
            relayAnswers.await(10, TimeUnit.SECONDS);
            return null;
        }).when(sender).send(any(MimeMessage.class));
        ExecutorService passes = Executors.newFixedThreadPool(2);

        // when
        try {
            Future<?> first = passes.submit(outbox::deliverDue);
            assertThat(welcomeIsSending.await(10, TimeUnit.SECONDS)).isTrue();
            Future<?> second = passes.submit(outbox::deliverDue);
            second.get(30, TimeUnit.SECONDS);
            List<String> sentWhileTheWelcomeWasOpen = List.copyOf(mailed);
            relayAnswers.countDown();
            first.get(30, TimeUnit.SECONDS);

            // then
            assertThat(sentWhileTheWelcomeWasOpen)
                    .as("the first password waits while the welcome is still on its way")
                    .singleElement().asString().contains("Willkommen");
        } finally {
            passes.shutdownNow();
        }
        assertThat(mailed).hasSize(2);
        assertThat(mailed.getLast()).contains("Courtside-Konto");
    }

    @Test
    void givenAWelcomeTheRelayRefused_whenTheOutboxRuns_thenTheFirstPasswordWaitsForItsRetry() {
        // given
        UUID accountId = aNewAccount();
        queued(accountId, MessageKind.ACCOUNT_WELCOME);
        queued(accountId, MessageKind.CREDENTIALS_NEW_ACCOUNT);
        List<String> mailed = new CopyOnWriteArrayList<>();
        doAnswer(invocation -> {
            String subject = ((MimeMessage) invocation.getArgument(0)).getSubject();
            mailed.add(subject);
            if (subject.contains("Willkommen")) {
                throw new MailSendException("relay down");
            }
            return null;
        }).when(sender).send(any(MimeMessage.class));

        // when
        outbox.deliverDue();

        // then
        assertThat(mailed).as("only the welcome was attempted").singleElement().asString().contains("Willkommen");
        assertThat(stateOf(accountId, MessageKind.CREDENTIALS_NEW_ACCOUNT))
                .as("the first password stays queued behind the welcome").isEqualTo("QUEUED");
    }

    private UUID aNewAccount() {
        UUID personId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        return identity.createAccountAwaitingCredentials(personId, "doe.jane", Set.of(Role.MEMBER));
    }

    private void queued(UUID accountId, MessageKind kind) {
        jdbc.sql("""
                        INSERT INTO message_record (id, account_id, kind, state, message_id, queued_at,
                                                    next_attempt_at)
                        VALUES (:id, :accountId, :kind, 'QUEUED', :messageId, :at, :at)
                        """)
                .param("id", UUID.randomUUID())
                .param("accountId", accountId)
                .param("kind", kind.name())
                .param("messageId", "<" + UUID.randomUUID() + "@example.org>")
                .param("at", Timestamp.from(NOW))
                .update();
    }

    private String stateOf(UUID accountId, MessageKind kind) {
        return jdbc.sql("SELECT state FROM message_record WHERE account_id = :account AND kind = :kind")
                .param("account", accountId).param("kind", kind.name())
                .query(String.class).single();
    }
}
