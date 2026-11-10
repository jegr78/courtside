package org.courtside.notification;

import jakarta.mail.Multipart;
import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.payment.PayPalEnvironment;
import org.courtside.payment.PaymentEvent;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.verify;

class PayPalRefundMailerTest extends AbstractIntegrationTest {

    @MockitoSpyBean
    private JavaMailSender sender;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private ApplicationEventPublisher events;

    @Autowired
    private TransactionTemplate transactions;

    @Autowired
    private JdbcClient jdbc;

    private UUID janeAccount;

    @BeforeEach
    void aPlayerWhoPaidByPayPal() {
        doNothing().when(sender).send(any(MimeMessage.class));
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        janeAccount = identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.EXTERNAL));
        clearInvocations(sender);
    }

    @Test
    void givenACompletedRefund_whenRecorded_thenThePlayerGetsTheAmountAndThePayPalWording() throws Exception {
        // given
        UUID bookingId = UUID.randomUUID();

        // when
        publish(refunded(bookingId, false));

        // then
        MimeMessage mail = sentTo("jane.doe@example.org");
        assertThat(mail.getSubject()).as("the subject says the PayPal payment went back")
                .startsWith("Courtside: ").contains("PayPal-Zahlung").contains("zurückgezahlt");
        assertThat(bodyOf(mail)).as("the body names the amount, PayPal and the dropped credit")
                .contains("12,50").contains("PayPal").contains("Guthaben");
    }

    @Test
    void givenAnEnglishAccount_whenTheRefundCompletes_thenTheMailIsEnglish() throws Exception {
        // given
        identity.changeLocale(janeAccount, "en");

        // when
        publish(refunded(UUID.randomUUID(), false));

        // then
        MimeMessage mail = sentTo("jane.doe@example.org");
        assertThat(mail.getSubject()).as("the English subject").contains("Your PayPal payment was refunded");
        assertThat(bodyOf(mail)).as("the English body names the amount").contains("12.50").contains("refunded");
    }

    @Test
    void givenAnAnonymisedAccount_whenTheRefundCompletes_thenNoMessageIsQueued() {
        // given
        publish(refunded(UUID.randomUUID(), false));
        long queuedForAPlayerWhoIsKnown = queuedFor(janeAccount);

        // when
        publish(refunded(UUID.randomUUID(), true));

        // then
        assertThat(queuedForAPlayerWhoIsKnown).as("a refund for a known account queues a message").isEqualTo(1);
        assertThat(queuedFor(janeAccount)).as("an anonymised account is told nothing")
                .isEqualTo(queuedForAPlayerWhoIsKnown);
    }

    private long queuedFor(UUID accountId) {
        return jdbc.sql("SELECT count(*) FROM message_record WHERE kind = 'PAYPAL_REFUNDED' AND account_id = :account")
                .param("account", accountId).query(Long.class).single();
    }

    private PaymentEvent.PayPalRefunded refunded(UUID bookingId, boolean anonymised) {
        return new PaymentEvent.PayPalRefunded(bookingId, janeAccount, "ORDER-1", PayPalEnvironment.SANDBOX,
                "REFUND-1", 1250, "EUR", anonymised);
    }

    private void publish(PaymentEvent.PayPalRefunded event) {
        transactions.executeWithoutResult(status -> events.publishEvent(event));
    }

    private MimeMessage sentTo(String address) throws Exception {
        var captured = forClass(MimeMessage.class);
        verify(sender, atLeast(1)).send(captured.capture());
        for (MimeMessage message : captured.getAllValues()) {
            if (address.equals(message.getAllRecipients()[0].toString())) {
                return message;
            }
        }
        throw new AssertionError("Nothing reached " + address);
    }

    private static String bodyOf(MimeMessage message) throws Exception {
        Object content = message.getContent();
        return content instanceof Multipart multipart
                ? multipart.getBodyPart(0).getContent().toString() : content.toString();
    }
}
