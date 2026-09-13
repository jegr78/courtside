package org.courtside.notification.internal;

import org.courtside.config.ClubIdentity;
import org.courtside.notification.MessageKind;
import org.courtside.shared.IssuedResetCode;
import org.courtside.shared.PasswordResetCodeIssuer;
import org.courtside.shared.PasswordResetRequested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.Instant;
import java.time.ZoneId;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PasswordResetCodeMailerTest {

    private static final UUID ACCOUNT = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final ZoneId ZONE = ZoneId.of("Europe/Berlin");
    private static final Instant EXPIRES_AT = Instant.parse("2026-04-24T10:00:00Z");
    private static final String ADDRESS = "jane.doe@example.org";
    private static final String CODE = "ABCD-EFGH";

    private final PasswordResetCodeIssuer codes = mock(PasswordResetCodeIssuer.class);
    private final ClubIdentity club = mock(ClubIdentity.class);
    private final MailDispatch dispatch = mock(MailDispatch.class);
    private final MessageLog messages = mock(MessageLog.class);
    private final MailProperties properties = new MailProperties(
            "mail.example.org", 587, "noreply@example.org", "board@example.org", null, null, false);
    private final MessageChoices choices = new MessageChoices(mock(JdbcClient.class));

    private final PasswordResetCodeMailer mailer = new PasswordResetCodeMailer(codes, club,
            new MailTemplates(),
            new RecordedHandover(dispatch, new MailHandover(gap -> { }), properties, choices, messages));

    @Test
    void givenAMemberWrittenToInEnglish_whenTheirCodeIsSent_thenTheMessageCarriesItAndItsDeadline() {
        // given
        club("de");
        issues("en");

        // when
        mailer.on(new PasswordResetRequested(ACCOUNT));

        // then — the club default is German, so only the account's own language can produce this
        assertThat(subjectSent()).isEqualTo("Example Tennis Club: your reset code");
        assertThat(bodySent())
                .contains("Hello Jane")
                .contains("Code: " + CODE)
                .as("a code that lives an hour expires at a clock time, not on a day, and in the"
                        + " club's zone rather than in UTC")
                .contains("4/24/26").contains("12:00");
    }

    @Test
    void givenAMemberWrittenToInGerman_whenTheirCodeIsSent_thenTheMessageIsInGerman() {
        // given
        club("en");
        issues("de");

        // when
        mailer.on(new PasswordResetRequested(ACCOUNT));

        // then
        assertThat(subjectSent()).isEqualTo("Example Tennis Club: dein Code zum Zurücksetzen");
        assertThat(bodySent()).contains("Hallo Jane").contains("Code: " + CODE);
    }

    @Test
    void whenTheCodeIsSent_thenNothingInTheMessageSaysThePasswordHasChanged() {
        // given
        club("en");
        issues("en");

        // when
        mailer.on(new PasswordResetRequested(ACCOUNT));

        // then — the message is the whole promise the endpoint makes, so it may not overstate it
        assertThat(bodySent())
                .contains("Nothing has changed yet")
                .contains("your password and your open sessions are untouched");
    }

    @Test
    void whenTheCodeIsSent_thenTheRecordCarriesItsOwnKindAndNotTheCredentialOne() {
        // given
        club("en");
        issues("en");

        // when
        mailer.on(new PasswordResetRequested(ACCOUNT));

        // then
        verify(messages).queued(eq(ACCOUNT), eq(MessageKind.ACCOUNT_PASSWORD_RESET_CODE), anyString());
        assertThat(MessageKind.ACCOUNT_PASSWORD_RESET_CODE.templateKey())
                .isEqualTo("account.passwordResetCode");
        assertThat(MessageKind.ACCOUNT_PASSWORD_RESET_CODE.isDeclinable())
                .as("a member who declined this could not get back into their account")
                .isFalse();
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
        when(codes.issueFor(ACCOUNT)).thenReturn(new IssuedResetCode(
                ADDRESS, "Jane", recipientLocale, "doe.jane", CODE, EXPIRES_AT));
    }

    private record Message(String recipient, String subject, String body) {
    }
}
