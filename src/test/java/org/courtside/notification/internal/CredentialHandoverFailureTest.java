package org.courtside.notification.internal;

import jakarta.mail.Address;
import jakarta.mail.SendFailedException;
import jakarta.mail.internet.AddressException;
import jakarta.mail.internet.InternetAddress;
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
import java.util.List;
import java.util.Map;
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
        // the row this log exists for is the one the rotation rolls back, so it stands on its own
        assertThat(recorded(accountId)).containsExactly("FAILED");
        assertThat(reasonRecorded(accountId)).isNotBlank();
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

    @Test
    void givenARecipientTheRelayRejects_whenTheCredentialIsRequested_thenItIsRefusedWithoutRepeating() {
        // given
        doThrow(refusal()).when(sender).send(any(MimeMessage.class));
        long outstandingBefore = undeliveredPublications();
        UUID personId = identity.createPerson("John", "Roe", "john.roe@example.org");
        UUID accountId = identity.createAccountAwaitingCredentials(personId,
                "roe.john." + UUID.randomUUID().toString().substring(0, 8), Set.of(Role.MEMBER));
        String hashBefore = identity.storedCredentialHash(accountId);

        // when
        transactions.executeWithoutResult(status ->
                events.publishEvent(new CredentialsRequested(accountId, CredentialsRequested.Reason.NEW_ACCOUNT)));

        // then — an address that does not exist will not exist on the fourth attempt either
        verify(sender, timeout(10_000).times(1)).send(any(MimeMessage.class));
        await().atMost(Duration.ofSeconds(10)).untilAsserted(() ->
                assertThat(recorded(accountId)).containsExactly("REFUSED"));
        assertThat(statusRecorded(accountId)).isEqualTo("550");
        assertThat(identity.storedCredentialHash(accountId)).isEqualTo(hashBefore);
        // Completing it would commit a credential nobody received; the record is what a board reads.
        await().atMost(Duration.ofSeconds(10)).untilAsserted(() ->
                assertThat(undeliveredPublications()).isEqualTo(outstandingBefore + 1));
    }

    @Test
    void givenAnInterruptedPause_whenItEscapes_thenTheRowStillSaysWhatBecameOfTheMessage() {
        // given — the one failure that does not come through MailDispatch, so no wrapper names it
        doThrow(new MailSendException("nothing is listening")).when(sender).send(any(MimeMessage.class));
        doThrow(new MailHandoverInterruptedException(new InterruptedException("shutting down")))
                .when(pause).untilTheNextAttempt(any());
        UUID personId = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        UUID accountId = identity.createAccountAwaitingCredentials(personId,
                "miles.richard." + UUID.randomUUID().toString().substring(0, 8), Set.of(Role.MEMBER));

        // when
        transactions.executeWithoutResult(status ->
                events.publishEvent(new CredentialsRequested(accountId, CredentialsRequested.Reason.NEW_ACCOUNT)));

        // then — a row left on queued would say the message is still on its way, and it is not
        await().atMost(Duration.ofSeconds(10)).untilAsserted(() ->
                assertThat(recorded(accountId)).containsExactly("FAILED"));
        assertThat(reasonRecorded(accountId)).isNotBlank();
    }

    @Test
    void givenAFailedHandover_whenItsEventIsRepublished_thenTheSecondAttemptIsASecondRow() {
        // given — a restart republishes what stayed outstanding, and each run is its own message
        doThrow(new MailSendException("nothing is listening")).when(sender).send(any(MimeMessage.class));
        UUID personId = identity.createPerson("Mary", "Major", "mary.major@example.org");
        UUID accountId = identity.createAccountAwaitingCredentials(personId,
                "major.mary." + UUID.randomUUID().toString().substring(0, 8), Set.of(Role.MEMBER));
        CredentialsRequested requested =
                new CredentialsRequested(accountId, CredentialsRequested.Reason.NEW_ACCOUNT);
        transactions.executeWithoutResult(status -> events.publishEvent(requested));
        await().atMost(Duration.ofSeconds(10)).untilAsserted(() ->
                assertThat(recorded(accountId)).containsExactly("FAILED"));

        // when
        transactions.executeWithoutResult(status -> events.publishEvent(requested));

        // then — the first row still says what became of the first message, which is the point of it
        await().atMost(Duration.ofSeconds(10)).untilAsserted(() ->
                assertThat(recorded(accountId)).containsExactly("FAILED", "FAILED"));
        assertThat(messageIdsRecorded(accountId)).hasSize(2).doesNotHaveDuplicates();
    }

    // The shape Spring builds for a rejected recipient: a failed message, not a cause. This path
    // runs through MailDispatch, which wraps it again, so both layers are exercised as they ship.
    private static MailSendException refusal() {
        try {
            return new MailSendException(Map.of("<a-message-id@example.org>",
                    new SendFailedException("550 5.1.1 user unknown", null, new Address[0],
                            new Address[0], new Address[]{new InternetAddress("nobody@example.org")})));
        } catch (AddressException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private List<String> recorded(UUID accountId) {
        return jdbc.sql("SELECT state FROM message_record WHERE account_id = :id")
                .param("id", accountId).query(String.class).list();
    }

    private List<String> messageIdsRecorded(UUID accountId) {
        return jdbc.sql("SELECT message_id FROM message_record WHERE account_id = :id")
                .param("id", accountId).query(String.class).list();
    }

    private String reasonRecorded(UUID accountId) {
        return jdbc.sql("SELECT reason FROM message_record WHERE account_id = :id")
                .param("id", accountId).query(String.class).single();
    }

    private String statusRecorded(UUID accountId) {
        return jdbc.sql("SELECT status_code FROM message_record WHERE account_id = :id")
                .param("id", accountId).query(String.class).single();
    }

    private long undeliveredPublications() {
        return jdbc.sql("SELECT count(*) FROM event_publication WHERE completion_date IS NULL")
                .query(Long.class).single();
    }
}
