package org.courtside.notification.internal;

import jakarta.mail.Address;
import jakarta.mail.SendFailedException;
import jakarta.mail.internet.AddressException;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.CredentialsRequested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@Import(IdentityTestFixture.class)
class CredentialHandoverFailureTest extends AbstractIntegrationTest {

    @MockitoSpyBean
    private JavaMailSender sender;

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

    @Test
    void givenARelayThatNeverAnswers_whenEveryAttemptIsSpent_thenTheRowSaysWhyAndNoCredentialWasStored() {
        // given
        doThrow(new MailSendException("nothing is listening")).when(sender).send(any(MimeMessage.class));
        UUID personId = identity.createPerson("John", "Roe", "john.roe@example.org");
        UUID accountId = identity.createAccountAwaitingCredentials(personId,
                "roe.john." + UUID.randomUUID().toString().substring(0, 8), Set.of(Role.MEMBER));
        String hashBefore = identity.storedCredentialHash(accountId);
        long epochBefore = identity.securityEpoch(accountId);
        long outstandingBefore = undeliveredPublications();

        // when
        transactions.executeWithoutResult(status ->
                events.publishEvent(new CredentialsRequested(accountId, CredentialsRequested.Reason.NEW_ACCOUNT)));
        for (int retry = 1; retry < MailOutbox.ATTEMPTS + 2; retry++) {
            dueNow(accountId);
            outbox.deliverDue();
        }

        // then
        verify(sender, times(MailOutbox.ATTEMPTS)).send(any(MimeMessage.class));
        assertThat(identity.storedCredentialHash(accountId))
                .as("a credential nobody received must not have replaced the one on file")
                .isEqualTo(hashBefore);
        assertThat(identity.securityEpoch(accountId))
                .as("and the sessions it would have ended are still the member's own")
                .isEqualTo(epochBefore);
        assertThat(recorded(accountId)).as("the bounded retries end in a failure").containsExactly("FAILED");
        assertThat(reasonRecorded(accountId)).as("a failure carries the reason it was given up").isNotBlank();
        assertThat(undeliveredPublications())
                .as("the row is the retained record, so the event itself has been taken care of")
                .isEqualTo(outstandingBefore);
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
        verify(sender, times(1)).send(any(MimeMessage.class));
        assertThat(recorded(accountId)).containsExactly("HANDED_OVER");
        assertThat(undeliveredPublications()).isEqualTo(outstandingBefore);
    }

    @Test
    void givenARecipientTheRelayRejects_whenTheCredentialIsRequested_thenItIsRefusedWithoutRepeating() {
        // given
        doThrow(refusal()).when(sender).send(any(MimeMessage.class));
        UUID personId = identity.createPerson("John", "Roe", "john.roe@example.org");
        UUID accountId = identity.createAccountAwaitingCredentials(personId,
                "roe.john." + UUID.randomUUID().toString().substring(0, 8), Set.of(Role.MEMBER));
        String hashBefore = identity.storedCredentialHash(accountId);

        // when
        transactions.executeWithoutResult(status ->
                events.publishEvent(new CredentialsRequested(accountId, CredentialsRequested.Reason.NEW_ACCOUNT)));
        dueNow(accountId);
        outbox.deliverDue();

        // then — an address that does not exist will not exist on the fourth attempt either
        verify(sender, times(1)).send(any(MimeMessage.class));
        assertThat(recorded(accountId)).containsExactly("REFUSED");
        assertThat(statusRecorded(accountId)).isEqualTo("550");
        assertThat(identity.storedCredentialHash(accountId)).isEqualTo(hashBefore);
    }

    @Test
    void givenAFailedHandover_whenTheRelayIsBackAndTheRetryComesDue_thenTheSameRowAndMessageIdGoOut()
            throws MessagingException {
        // given
        doThrow(new MailSendException("nothing is listening")).when(sender).send(any(MimeMessage.class));
        UUID personId = identity.createPerson("Mary", "Major", "mary.major@example.org");
        UUID accountId = identity.createAccountAwaitingCredentials(personId,
                "major.mary." + UUID.randomUUID().toString().substring(0, 8), Set.of(Role.MEMBER));
        String hashBefore = identity.storedCredentialHash(accountId);
        transactions.executeWithoutResult(status -> events.publishEvent(
                new CredentialsRequested(accountId, CredentialsRequested.Reason.NEW_ACCOUNT)));
        assertThat(recorded(accountId)).as("a first failure waits for its retry").containsExactly("QUEUED");

        // when
        doNothing().when(sender).send(any(MimeMessage.class));
        dueNow(accountId);
        outbox.deliverDue();

        // then — one message, tried twice under one name, so a mailbox can tell a repeat from a second
        ArgumentCaptor<MimeMessage> sent = ArgumentCaptor.forClass(MimeMessage.class);
        verify(sender, times(2)).send(sent.capture());
        assertThat(sent.getAllValues().get(1).getHeader("Message-ID"))
                .containsExactly(sent.getAllValues().get(0).getHeader("Message-ID"));
        assertThat(recorded(accountId)).containsExactly("HANDED_OVER");
        assertThat(messageIdsRecorded(accountId)).containsExactly(sent.getAllValues().get(1).getHeader("Message-ID"));
        assertThat(identity.storedCredentialHash(accountId))
                .as("the credential that went out is the one now on file")
                .isNotEqualTo(hashBefore);
    }

    private void dueNow(UUID accountId) {
        jdbc.sql("UPDATE message_record SET next_attempt_at = queued_at WHERE account_id = :id AND state = 'QUEUED'")
                .param("id", accountId).update();
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
