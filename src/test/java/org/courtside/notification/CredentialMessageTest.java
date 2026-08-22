package org.courtside.notification;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.CredentialsRequested;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.support.TransactionTemplate;

import jakarta.mail.internet.MimeMessage;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

class CredentialMessageTest extends AbstractIntegrationTest {

    @MockitoSpyBean
    private JavaMailSender sender;

    @Autowired
    private ApplicationEventPublisher events;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private PersonRepository people;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private TransactionTemplate transactions;

    @BeforeEach
    void captureInsteadOfSending() {
        doNothing().when(sender).send(org.mockito.ArgumentMatchers.any(MimeMessage.class));
    }

    @Test
    void givenAnAccountAwaitingItsFirstCredential_whenTheEventIsRaised_thenTheMemberIsWrittenTo()
            throws Exception {
        // given
        UUID accountId = anAccountAwaitingItsCredential();

        // when
        transactions.executeWithoutResult(status ->
                events.publishEvent(new CredentialsRequested(accountId,
                        CredentialsRequested.Reason.NEW_ACCOUNT)));

        // then
        var message = forClass(MimeMessage.class);
        verify(sender, timeout(10_000)).send(message.capture());
        MimeMessage sent = message.getValue();
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
        transactions.executeWithoutResult(status ->
                events.publishEvent(new CredentialsRequested(accountId,
                        CredentialsRequested.Reason.PASSWORD_RESET)));

        // then
        var message = forClass(MimeMessage.class);
        verify(sender, timeout(10_000)).send(message.capture());
        assertThat(body(message.getValue())).contains("neues Passwort ausgestellt");
    }

    @Test
    void whenAMemberIsWrittenTo_thenTheCredentialIsInTheMessageAndNowhereElse() throws Exception {
        // given
        UUID accountId = anAccountAwaitingItsCredential();

        // when
        transactions.executeWithoutResult(status ->
                events.publishEvent(new CredentialsRequested(accountId,
                        CredentialsRequested.Reason.NEW_ACCOUNT)));
        var message = forClass(MimeMessage.class);
        verify(sender, timeout(10_000)).send(message.capture());

        // then — what the member reads signs them in, and the store holds only its hash
        String credential = credentialIn(body(message.getValue()));
        UserAccount account = accounts.findById(accountId).orElseThrow();
        assertThat(passwordEncoder.matches(credential, account.getPasswordHash())).isTrue();
        assertThat(account.getPasswordHash()).doesNotContain(credential);
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
        return transactions.execute(status -> {
            Person person = people.save(new Person("Jane", "Doe", "jane.doe@example.org"));
            UserAccount account = UserAccount.awaitingCredentials(person,
                    "doe.jane." + UUID.randomUUID().toString().substring(0, 8),
                    passwordEncoder.encode(UUID.randomUUID().toString()), Set.of(Role.MEMBER));
            return accounts.save(account).getId();
        });
    }

}
