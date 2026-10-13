package org.courtside.member;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@TestPropertySource(properties = "courtside.public-url=https://courts.example.org")
@Import(IdentityTestFixture.class)
class WelcomeMessageTest extends AbstractIntegrationTest {

    @MockitoSpyBean
    private JavaMailSender sender;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private RosterService roster;

    @Autowired
    private JdbcClient jdbc;

    @BeforeEach
    void captureInsteadOfSending() {
        doNothing().when(sender).send(any(MimeMessage.class));
    }

    @Test
    void givenAClubWithAnAddress_whenTheBoardCreatesAnAccount_thenTheWelcomeWithTheLinkArrivesBeforeTheFirstPassword()
            throws Exception {
        // given
        UUID person = identity.createPerson("Jane", "Doe", "jane.doe@example.org");

        // when
        roster.createAccount(person, "doe.jane", Set.of(Role.MEMBER));

        // then
        List<MimeMessage> sent = handedOver(2);
        String welcome = sent.getFirst().getContent().toString();
        assertThat(sent.getFirst().getSubject()).as("the first mail is the welcome").contains("Willkommen");
        assertThat(welcome)
                .as("the welcome ends with the instance's address on its own line")
                .endsWith("\nhttps://courts.example.org/")
                .contains("Hallo Jane")
                .doesNotContain("doe.jane", "Einmalpasswort:");
        assertThat(sent.getLast().getContent().toString())
                .as("the second mail carries the first password and no link")
                .contains("Einmalpasswort:")
                .doesNotContain("https://");
    }

    @Test
    void givenAnAccountThatNeverSignedIn_whenTheBoardIssuesItsPasswordAgain_thenNoSecondWelcomeIsSent()
            throws Exception {
        // given
        UUID person = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        roster.createAccount(person, "doe.jane", Set.of(Role.MEMBER));
        handedOver(2);
        clearInvocations(sender);

        // when
        roster.requestCredentials(person);

        // then
        assertThat(handedOver(1).getFirst().getContent().toString()).contains("Einmalpasswort:");
        await().during(Duration.ofSeconds(1)).atMost(Duration.ofSeconds(3)).untilAsserted(() ->
                assertThat(welcomesQueued()).as("the account was welcomed once, when it was created").isEqualTo(1));
    }

    @Test
    void givenAMemberWhoChoseTheirPassword_whenTheBoardIssuesANewOne_thenNoWelcomeIsSent() throws Exception {
        // given
        UUID person = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        identity.createEnabledAccount(person, "doe.jane", Set.of(Role.MEMBER));

        // when
        roster.requestCredentials(person);

        // then
        assertThat(handedOver(1).getFirst().getContent().toString()).contains("neues Einmalpasswort");
        assertThat(welcomesQueued()).as("a board-issued password is no welcome").isZero();
    }

    private List<MimeMessage> handedOver(int count) {
        var messages = forClass(MimeMessage.class);
        verify(sender, timeout(10_000).times(count)).send(messages.capture());
        return messages.getAllValues();
    }

    private long welcomesQueued() {
        return jdbc.sql("SELECT count(*) FROM message_record WHERE kind = 'ACCOUNT_WELCOME'")
                .query(Long.class).single();
    }
}
