package org.courtside.member;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

@Import(IdentityTestFixture.class)
class WelcomeMessageWithoutAddressTest extends AbstractIntegrationTest {

    @MockitoSpyBean
    private JavaMailSender sender;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private RosterService roster;

    @Test
    void givenAClubWithoutAnAddress_whenTheBoardCreatesAnAccount_thenTheWelcomeArrivesWithoutTheLinkLine()
            throws Exception {
        // given
        doNothing().when(sender).send(any(MimeMessage.class));
        UUID person = identity.createPerson("Jane", "Doe", "jane.doe@example.org");

        // when
        roster.createAccount(person, "doe.jane", Set.of(Role.MEMBER));

        // then
        var messages = forClass(MimeMessage.class);
        verify(sender, timeout(10_000).times(2)).send(messages.capture());
        List<MimeMessage> sent = messages.getAllValues();
        assertThat(sent.getFirst().getSubject()).as("the welcome still goes first").contains("Willkommen");
        assertThat(sent.getFirst().getContent().toString())
                .as("the welcome reaches the member without a link line")
                .contains("Hallo Jane")
                .doesNotContain("{instanceLink}", "https://")
                .doesNotEndWith("\n");
        assertThat(sent.getLast().getContent().toString()).contains("Einmalpasswort:");
    }
}
