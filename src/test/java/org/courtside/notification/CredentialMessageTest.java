package org.courtside.notification;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.CredentialsRequested;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Import;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.support.TransactionTemplate;

import jakarta.mail.internet.MimeMessage;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

@Import(IdentityTestFixture.class)
class CredentialMessageTest extends AbstractIntegrationTest {

    @MockitoSpyBean
    private JavaMailSender sender;

    @Autowired
    private ApplicationEventPublisher events;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private TransactionTemplate transactions;

    @BeforeEach
    void captureInsteadOfSending() {
        doNothing().when(sender).send(any(MimeMessage.class));
    }

    @Test
    void givenAnAccountAwaitingItsFirstCredential_whenTheEventIsRaised_thenTheMemberIsWrittenTo()
            throws Exception {
        // given
        UUID accountId = anAccountAwaitingItsCredential();

        // when
        raise(accountId, CredentialsRequested.Reason.NEW_ACCOUNT);

        // then
        MimeMessage sent = theMessageHandedOver();
        assertThat(sent.getAllRecipients()[0].toString()).isEqualTo("jane.doe@example.org");
        assertThat(sent.getHeader("Message-ID")[0]).contains("@courtside.test");
        assertThat(body(sent)).contains("Benutzername:").doesNotContain("User name:");
    }

    @Test
    void givenAPasswordReset_whenTheEventIsRaised_thenTheMessageSaysSoRatherThanWelcoming()
            throws Exception {
        // given
        UUID accountId = anAccountAwaitingItsCredential();

        // when
        raise(accountId, CredentialsRequested.Reason.PASSWORD_RESET);

        // then
        assertThat(body(theMessageHandedOver())).contains("neues Passwort ausgestellt");
    }

    @Test
    void whenAMemberIsWrittenTo_thenTheCredentialIsInTheMessageAndNowhereElse() throws Exception {
        // given
        UUID accountId = anAccountAwaitingItsCredential();

        // when
        raise(accountId, CredentialsRequested.Reason.NEW_ACCOUNT);

        // then — what the member reads signs them in, and the store holds only its hash
        String credential = credentialIn(body(theMessageHandedOver()));
        assertThat(identity.credentialSignsIn(accountId, credential)).isTrue();
        assertThat(identity.storedCredentialHash(accountId)).doesNotContain(credential);
    }

    private void raise(UUID accountId, CredentialsRequested.Reason reason) {
        transactions.executeWithoutResult(status ->
                events.publishEvent(new CredentialsRequested(accountId, reason)));
    }

    private MimeMessage theMessageHandedOver() {
        var message = forClass(MimeMessage.class);
        verify(sender, timeout(10_000)).send(message.capture());
        return message.getValue();
    }

    private static String body(MimeMessage message) throws Exception {
        return message.getContent().toString();
    }

    private static String credentialIn(String body) {
        String marker = "Passwort: ";
        int start = body.indexOf(marker) + marker.length();
        return body.substring(start, body.indexOf('\n', start)).trim();
    }

    private UUID anAccountAwaitingItsCredential() {
        UUID personId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        return identity.createAccountAwaitingCredentials(personId,
                "doe.jane." + UUID.randomUUID().toString().substring(0, 8), Set.of(Role.MEMBER));
    }
}
