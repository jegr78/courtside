package org.courtside.notification.internal;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.CredentialsRequested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

@Import(IdentityTestFixture.class)
class CredentialHandoverFailureTest extends AbstractIntegrationTest {

    @MockitoSpyBean
    private JavaMailSender sender;

    @MockitoBean
    private MailPause pause;

    @Autowired
    private ApplicationEventPublisher events;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private TransactionTemplate transactions;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenARelayThatNeverAnswers_whenTheCredentialIsRequested_thenTheEventStaysUndelivered() {
        // given
        doThrow(new MailSendException("nothing is listening")).when(sender).send(any(MimeMessage.class));
        long outstandingBefore = undeliveredPublications();
        UUID personId = identity.createPerson("John", "Roe", "john.roe@example.org");
        UUID accountId = identity.createAccountAwaitingCredentials(personId,
                "roe.john." + UUID.randomUUID().toString().substring(0, 8), Set.of(Role.MEMBER));
        String hashBefore = identity.storedCredentialHash(accountId);
        long epochBefore = identity.securityEpoch(accountId);

        // when
        transactions.executeWithoutResult(status ->
                events.publishEvent(new CredentialsRequested(accountId, CredentialsRequested.Reason.NEW_ACCOUNT)));

        // then — every attempt was spent, and nothing recorded a delivery that never happened
        verify(sender, timeout(10_000).times(4)).send(any(MimeMessage.class));
        await().atMost(Duration.ofSeconds(10)).untilAsserted(() ->
                assertThat(identity.storedCredentialHash(accountId))
                        .as("a credential nobody received must not have replaced the one on file")
                        .isEqualTo(hashBefore));
        assertThat(identity.securityEpoch(accountId))
                .as("and the sessions it would have ended are still the member's own")
                .isEqualTo(epochBefore);
        await().atMost(Duration.ofSeconds(10))
                .untilAsserted(() -> assertThat(undeliveredPublications()).isEqualTo(outstandingBefore + 1));
    }

    @Test
    void givenARelayThatAnswers_whenTheCredentialIsRequested_thenNothingStaysOutstanding() {
        // given
        doNothing().when(sender).send(any(MimeMessage.class));
        long outstandingBefore = undeliveredPublications();
        UUID personId = identity.createPerson("Mary", "Major", "mary.major@example.org");
        UUID accountId = identity.createAccountAwaitingCredentials(personId,
                "major.mary." + UUID.randomUUID().toString().substring(0, 8), Set.of(Role.MEMBER));

        // when
        transactions.executeWithoutResult(status ->
                events.publishEvent(new CredentialsRequested(accountId, CredentialsRequested.Reason.NEW_ACCOUNT)));

        // then
        verify(sender, timeout(10_000).times(1)).send(any(MimeMessage.class));
        await().atMost(Duration.ofSeconds(10))
                .untilAsserted(() -> assertThat(undeliveredPublications()).isEqualTo(outstandingBefore));
    }

    private long undeliveredPublications() {
        return jdbc.sql("SELECT count(*) FROM event_publication WHERE completion_date IS NULL")
                .query(Long.class).single();
    }
}
