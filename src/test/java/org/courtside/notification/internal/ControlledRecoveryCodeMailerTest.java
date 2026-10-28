package org.courtside.notification.internal;

import org.courtside.config.ClubIdentity;
import org.courtside.identity.ControlledRecoveryCodeIssuer;
import org.courtside.identity.ControlledRecoveryRequested;
import org.courtside.identity.UserAccountRepository;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.AbstractIntegrationTest;
import org.courtside.notification.MessageKind;
import org.courtside.shared.IssuedResetCode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@Import(IdentityTestFixture.class)
class ControlledRecoveryCodeMailerTest extends AbstractIntegrationTest {
    private final ControlledRecoveryCodeIssuer codes = mock(ControlledRecoveryCodeIssuer.class);
    @Autowired private UserAccountRepository accounts;
    @Autowired private IdentityTestFixture identity;
    private final ClubIdentity club = mock(ClubIdentity.class);
    private final MessageOutbox outbox = mock(MessageOutbox.class);
    private ControlledRecoveryCodeMailer mailer;

    @BeforeEach
    void setUp() {
        mailer = new ControlledRecoveryCodeMailer(codes, accounts, club,
                new MailTemplates(mock(MessageTemplateOverrides.class)), new InstanceLinks(""), outbox);
    }

    @Test
    void givenRecoveryInitiation_whenQueued_thenNoPlaintextCodeIsWritten() {
        // given
        UUID account = UUID.randomUUID();
        UUID recovery = UUID.randomUUID();
        // when
        mailer.on(new ControlledRecoveryRequested(account, recovery));
        // then
        verify(outbox).queue(account, MessageKind.ACCOUNT_MFA_RECOVERY_CODE, Map.of("recoveryId", recovery.toString()));
        verifyNoInteractions(codes);
    }

    @Test
    void givenAnEnglishHolder_whenComposed_thenTheMailCarriesTheCodeAndExplainsItsEffect() {
        // given
        List<OutgoingMail> sent = compose("en");
        // when / then
        assertThat(sent).hasSize(1);
        assertThat(sent.getFirst().subject()).doesNotContain("ABCD-EFGH");
        assertThat(sent.getFirst().body()).contains("ABCD-EFGH", "previous sign-in is blocked", "new permanent password", "removes your previous second factors");
    }

    @Test
    void givenAGermanHolder_whenComposed_thenTheMailExplainsTheBlockedSignInAndNewPassword() {
        // given
        List<OutgoingMail> sent = compose("de");
        // when / then
        assertThat(sent.getFirst().body()).contains("ABCD-EFGH", "Anmeldung ist gesperrt", "dauerhaften Passwort", "zweiten Faktoren");
        assertThat(MessageTemplateCatalog.check(MessageKind.ACCOUNT_MFA_RECOVERY_CODE,
                MessageTemplateCatalog.shipped(MessageKind.ACCOUNT_MFA_RECOVERY_CODE, "de"))).isEmpty();
    }

    private List<OutgoingMail> compose(String locale) {
        UUID id = identity.createEnabledAccount(identity.createPerson("Jane", "Doe", "jane.doe@example.org"),
                "doe.jane", Set.of());
        identity.changeLocale(id, locale);
        UUID recovery = UUID.randomUUID();
        when(codes.issueFor(id, recovery)).thenReturn(new IssuedResetCode("jane.doe@example.org", "Jane", locale,
                "doe.jane", "ABCD-EFGH", Instant.parse("2026-10-27T18:00:00Z")));
        when(club.clubName()).thenReturn("Example Tennis Club");
        when(club.defaultLocale()).thenReturn("de");
        when(club.zoneId()).thenReturn(ZoneId.of("Europe/Berlin"));
        List<OutgoingMail> sent = new ArrayList<>();
        mailer.compose(new QueuedMessage(id, MessageKind.ACCOUNT_MFA_RECOVERY_CODE, Map.of("recoveryId", recovery.toString())), sent::add);
        return sent;
    }
}
