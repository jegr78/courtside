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
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.io.IOException;
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
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;

@Import(IdentityTestFixture.class)
class CredentialMailOrderTest extends AbstractIntegrationTest {

    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");
    private static final Pattern CREDENTIAL = Pattern.compile("[A-Za-z0-9_-]{32}");

    @MockitoSpyBean
    private JavaMailSender sender;

    @MockitoBean(name = "mailOutboxExecutor")
    private TaskExecutor executor;

    @Autowired
    private MailOutbox outbox;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private PasswordEncoder passwords;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenTwoCredentialMessagesForOneAccount_whenTwoPassesComposeThemAtOnce_thenTheLastMailCarriesTheStoredCredential()
            throws Exception {
        // given
        UUID personId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID accountId = identity.createAccountAwaitingCredentials(personId, "doe.jane", Set.of(Role.MEMBER));
        queued(accountId, "<first@example.org>");
        queued(accountId, "<second@example.org>");
        CountDownLatch firstIsSending = new CountDownLatch(1);
        CountDownLatch relayAnswers = new CountDownLatch(1);
        List<String> mailed = new CopyOnWriteArrayList<>();
        doAnswer(invocation -> {
            mailed.add(credentialIn(invocation.getArgument(0)));
            firstIsSending.countDown();
            relayAnswers.await(10, TimeUnit.SECONDS);
            return null;
        }).when(sender).send(any(MimeMessage.class));
        ExecutorService passes = Executors.newFixedThreadPool(2);

        // when
        try {
            Future<?> first = passes.submit(outbox::deliverDue);
            assertThat(firstIsSending.await(10, TimeUnit.SECONDS)).isTrue();
            Future<?> second = passes.submit(outbox::deliverDue);
            Thread.sleep(500);
            int sentWhileTheFirstWasOpen = mailed.size();
            relayAnswers.countDown();
            first.get(30, TimeUnit.SECONDS);
            second.get(30, TimeUnit.SECONDS);

            // then
            assertThat(sentWhileTheFirstWasOpen)
                    .as("a second credential for the account waits until the first one is stored")
                    .isEqualTo(1);
        } finally {
            passes.shutdownNow();
        }
        assertThat(mailed).hasSize(2);
        assertThat(passwords.matches(mailed.getLast(), identity.storedCredentialHash(accountId)))
                .as("the credential in the last mail is the one the account holds")
                .isTrue();
    }

    private void queued(UUID accountId, String messageId) {
        jdbc.sql("""
                        INSERT INTO message_record (id, account_id, kind, state, message_id, queued_at,
                                                    next_attempt_at)
                        VALUES (:id, :accountId, :kind, 'QUEUED', :messageId, :at, :at)
                        """)
                .param("id", UUID.randomUUID())
                .param("accountId", accountId)
                .param("kind", MessageKind.CREDENTIALS_NEW_ACCOUNT.name())
                .param("messageId", messageId)
                .param("at", java.sql.Timestamp.from(NOW))
                .update();
    }

    private static String credentialIn(MimeMessage message) throws IOException, jakarta.mail.MessagingException {
        Matcher found = CREDENTIAL.matcher(String.valueOf(message.getContent()));
        assertThat(found.find()).as("the mail carries a generated credential").isTrue();
        return found.group();
    }
}
