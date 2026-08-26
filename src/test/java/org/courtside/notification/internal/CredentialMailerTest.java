package org.courtside.notification.internal;

import org.courtside.config.ClubIdentity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.courtside.config.CredentialValidity;
import org.courtside.notification.MessageKind;
import org.courtside.shared.CredentialIssuer;
import org.courtside.shared.CredentialsRequested;
import org.courtside.shared.IssuedCredential;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CredentialMailerTest {

    private static final UUID ACCOUNT = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final ZoneId ZONE = ZoneId.of("Europe/Berlin");
    private static final Instant NOW = Instant.parse("2026-04-24T09:00:00Z");
    private static final String ADDRESS = "jane.doe@example.org";

    private final CredentialIssuer credentials = mock(CredentialIssuer.class);
    private final CredentialValidity validity = mock(CredentialValidity.class);
    private final ClubIdentity club = mock(ClubIdentity.class);
    private final MailDispatch dispatch = mock(MailDispatch.class);
    private final MailProperties properties = new MailProperties(
            "mail.example.org", 587, "noreply@example.org", "board@example.org", null, null, false);

    private final MessageLog messages = mock(MessageLog.class);

    // A credential is not declinable, so the choice is asked and always answers yes.
    private final MessageChoices choices = new MessageChoices(mock(JdbcClient.class));

    private final CredentialMailer mailer = new CredentialMailer(credentials, validity, club,
            new MailTemplates(),
            new RecordedHandover(dispatch, new MailHandover(gap -> { }), properties, choices, messages),
            Clock.fixed(NOW, ZONE));

    @Test
    void givenAnAccountWrittenToInEnglish_whenItsCredentialIsSent_thenTheMessageIsInEnglish() {
        // given
        club("de");
        issues("en");

        // when
        mailer.on(new CredentialsRequested(ACCOUNT, CredentialsRequested.Reason.NEW_ACCOUNT));

        // then — the club default is German, so only the account's own language can produce this
        assertThat(subjectSent()).isEqualTo("Example Tennis Club: access for Jane");
        assertThat(bodySent()).contains("Hello Jane").contains("May 1, 2026");
    }

    @Test
    void givenAnAccountWrittenToInGerman_whenItsCredentialIsSent_thenTheMessageIsInGerman() {
        // given
        club("en");
        issues("de");

        // when
        mailer.on(new CredentialsRequested(ACCOUNT, CredentialsRequested.Reason.PASSWORD_RESET));

        // then
        assertThat(subjectSent()).isEqualTo("Example Tennis Club: ein neues Passwort für Jane");
        assertThat(bodySent()).contains("Hallo Jane").contains("1. Mai 2026");
    }

    @Test
    void givenAnAccountCarryingNoLanguageOfItsOwn_whenItsCredentialIsSent_thenTheClubDefaultDecides() {
        // given
        club("de");
        issues(null);

        // when
        mailer.on(new CredentialsRequested(ACCOUNT, CredentialsRequested.Reason.NEW_ACCOUNT));

        // then
        assertThat(subjectSent()).isEqualTo("Example Tennis Club: Zugang für Jane");
    }

    @Test
    void givenAParentReceivingForTwoChildren_whenBothAreSent_thenTheSubjectsTellThemApart() {
        // given
        club("de");
        when(validity.validFor(any())).thenReturn(Duration.ofDays(7));
        UUID sibling = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000002");
        issuesTo(ACCOUNT, "Jane", "doe.jane");
        issuesTo(sibling, "John", "roe.john");

        // when
        mailer.on(new CredentialsRequested(ACCOUNT, CredentialsRequested.Reason.NEW_ACCOUNT));
        mailer.on(new CredentialsRequested(sibling, CredentialsRequested.Reason.NEW_ACCOUNT));

        // then
        ArgumentCaptor<String> subjects = ArgumentCaptor.forClass(String.class);
        verify(dispatch, times(2)).send(eq(ADDRESS), subjects.capture(), anyString(), anyString());
        assertThat(subjects.getAllValues())
                .as("one inbox holds both, so the subject is what separates them")
                .containsExactly("Example Tennis Club: Zugang für Jane",
                        "Example Tennis Club: Zugang für John");
    }

    private void issuesTo(UUID accountId, String firstName, String username) {
        when(credentials.issueFor(eq(accountId), any())).thenReturn(new IssuedCredential(
                ADDRESS, firstName, "de", username, "a-credential", NOW.plus(Duration.ofDays(7))));
    }

    @Test
    void givenTheTwoReasonsAMemberIsWrittenTo_whenTheyAreSent_thenTheRecordCarriesTheMessagesOwnName() {
        // given
        club("de");
        issues("de");

        // when
        mailer.on(new CredentialsRequested(ACCOUNT, CredentialsRequested.Reason.NEW_ACCOUNT));
        mailer.on(new CredentialsRequested(ACCOUNT, CredentialsRequested.Reason.PASSWORD_RESET));

        // then — the template's own key, so a later message joins without identity's vocabulary
        ArgumentCaptor<MessageKind> kinds = ArgumentCaptor.forClass(MessageKind.class);
        verify(messages, times(2)).queued(eq(ACCOUNT), kinds.capture(), anyString());
        assertThat(kinds.getAllValues()).containsExactly(
                MessageKind.CREDENTIALS_NEW_ACCOUNT, MessageKind.CREDENTIALS_PASSWORD_RESET);
        assertThat(kinds.getAllValues()).extracting(MessageKind::templateKey)
                .containsExactly("credentials.newAccount", "credentials.passwordReset");
    }

    private String subjectSent() {
        return handedOver().subject();
    }

    private String bodySent() {
        return handedOver().body();
    }

    private Message handedOver() {
        ArgumentCaptor<String> recipient = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> subject = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        verify(dispatch).send(recipient.capture(), subject.capture(), body.capture(), anyString());
        return new Message(recipient.getValue(), subject.getValue(), body.getValue());
    }

    private void club(String defaultLocale) {
        when(club.clubName()).thenReturn("Example Tennis Club");
        when(club.defaultLocale()).thenReturn(defaultLocale);
        when(club.zoneId()).thenReturn(ZONE);
    }

    private void issues(String recipientLocale) {
        when(validity.validFor(any())).thenReturn(Duration.ofDays(7));
        when(credentials.issueFor(eq(ACCOUNT), any())).thenReturn(new IssuedCredential(
                ADDRESS, "Jane", recipientLocale, "doe.jane", "a-credential", NOW.plus(Duration.ofDays(7))));
    }

    private record Message(String recipient, String subject, String body) {
    }
}
