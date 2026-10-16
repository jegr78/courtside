package org.courtside.notification;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.notification.internal.MessageTemplateService;
import org.courtside.notification.internal.MessageText;
import org.courtside.shared.CredentialsRequested;
import org.courtside.shared.UsernameReminderRequested;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

@TestPropertySource(properties = "courtside.public-url=https://courts.example.org")
@Import(IdentityTestFixture.class)
class ClubWordingMessageTest extends AbstractIntegrationTest {

    @MockitoSpyBean
    private JavaMailSender sender;

    @Autowired
    private ApplicationEventPublisher events;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private TransactionTemplate transactions;

    @Autowired
    private MessageTemplateService templates;

    @Autowired
    private JdbcClient jdbc;

    @BeforeEach
    void captureInsteadOfSending() {
        doNothing().when(sender).send(any(MimeMessage.class));
        jdbc.sql("DELETE FROM message_template_override").update();
    }

    @Test
    void givenTheClubsGermanWordingOfTheUsernameReminder_whenAGermanMemberAsks_thenTheClubsWordingIsSent()
            throws Exception {
        // given
        UUID accountId = anAccount("de");
        templates.change(MessageKind.ACCOUNT_USERNAME_REMINDER, "de",
                new MessageText("{clubName}: Ihr Zugang", "Hallo {firstName}, Ihr Zugang lautet {username}."));

        // when
        transactions.executeWithoutResult(status -> events.publishEvent(new UsernameReminderRequested(accountId)));

        // then
        MimeMessage sent = theMessageHandedOver();
        assertThat(sent.getSubject()).endsWith(": Ihr Zugang");
        assertThat(sent.getContent().toString()).startsWith("Hallo Jane, Ihr Zugang lautet ");
    }

    @Test
    void givenOnlyAnEnglishWording_whenAGermanMemberAsks_thenTheShippedGermanWordingIsSent() throws Exception {
        // given
        UUID accountId = anAccount("de");
        templates.change(MessageKind.ACCOUNT_USERNAME_REMINDER, "en",
                new MessageText("{clubName}: your login", "Hi {firstName}, it is {username}."));

        // when
        transactions.executeWithoutResult(status -> events.publishEvent(new UsernameReminderRequested(accountId)));

        // then
        assertThat(theMessageHandedOver().getContent().toString())
                .as("each language keeps its own wording").doesNotContain("Hi Jane").contains("Benutzername:");
    }

    @Test
    void givenAFirstPasswordWordingWithTheInstanceLink_whenItIsSent_thenTheLinkLeadsToTheInstance() throws Exception {
        // given
        UUID accountId = anAccount("en");
        templates.change(MessageKind.CREDENTIALS_NEW_ACCOUNT, "en", new MessageText("{clubName}: your account",
                "Sign in at {instanceLink} as {username} with {credential}."));

        // when
        transactions.executeWithoutResult(status -> events.publishEvent(
                new CredentialsRequested(accountId, CredentialsRequested.Reason.NEW_ACCOUNT, false)));

        // then
        assertThat(theMessageHandedOver().getContent().toString())
                .startsWith("Sign in at https://courts.example.org/ as ");
    }

    @Test
    void givenAResetWording_whenTheMemberAsks_thenTheShippedWordingIsSentAgain() throws Exception {
        // given
        UUID accountId = anAccount("en");
        templates.change(MessageKind.ACCOUNT_USERNAME_REMINDER, "en",
                new MessageText("{clubName}: your login", "Hi {firstName}, it is {username}."));
        templates.reset(MessageKind.ACCOUNT_USERNAME_REMINDER, "en");

        // when
        transactions.executeWithoutResult(status -> events.publishEvent(new UsernameReminderRequested(accountId)));

        // then
        assertThat(theMessageHandedOver().getContent().toString()).startsWith("Hello Jane,");
    }

    private UUID anAccount(String locale) {
        UUID personId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID accountId = identity.createEnabledAccount(personId,
                "doe.jane." + UUID.randomUUID().toString().substring(0, 8), Set.of(Role.MEMBER));
        jdbc.sql("UPDATE user_account SET locale = :locale WHERE id = :id")
                .param("locale", locale).param("id", accountId).update();
        return accountId;
    }

    private MimeMessage theMessageHandedOver() {
        var message = forClass(MimeMessage.class);
        verify(sender, timeout(10_000)).send(message.capture());
        return message.getValue();
    }
}
