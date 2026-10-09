package org.courtside.notification.internal;

import org.courtside.config.ClubIdentity;
import org.courtside.identity.Person;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.shared.IssuedResetCode;
import org.courtside.shared.PasswordResetCodeIssuer;
import org.courtside.shared.PasswordResetRequested;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PasswordResetCodeMailerTest {

    private static final UUID ACCOUNT = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final ZoneId ZONE = ZoneId.of("Europe/Berlin");
    private static final Instant EXPIRES_AT = Instant.parse("2026-04-24T10:00:00Z");
    private static final String ADDRESS = "jane.doe@example.org";
    private static final String CODE = "ABCD-EFGH";

    private final PasswordResetCodeIssuer codes = mock(PasswordResetCodeIssuer.class);
    private final UserAccountRepository accounts = mock(UserAccountRepository.class);
    private final ClubIdentity club = mock(ClubIdentity.class);
    private final MessageOutbox outbox = mock(MessageOutbox.class);
    private final List<OutgoingMail> handedOver = new ArrayList<>();

    private final PasswordResetCodeMailer mailer = new PasswordResetCodeMailer(codes, accounts, club,
            new MailTemplates(), outbox);

    @Test
    void givenAMemberWrittenToInEnglish_whenTheirCodeIsSent_thenTheMessageCarriesItAndItsDeadline() {
        // given
        club("de");
        issues("en");

        // when
        compose();

        // then — the club default is German, so only the account's own language can produce this
        assertThat(subjectSent()).isEqualTo("Example Tennis Club: your password reset code");
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
        compose();

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
        compose();

        // then — the message is the whole promise the endpoint makes, so it may not overstate it
        assertThat(bodySent())
                .contains("Your password and open sessions remain unchanged until the code is used");
    }

    @Test
    void whenTheCodeIsRequested_thenTheRowCarriesItsOwnKindAndTheCodeIsNotYetIssued() {
        // when
        mailer.on(new PasswordResetRequested(ACCOUNT));

        // then
        verify(outbox).queue(eq(ACCOUNT), eq(MessageKind.ACCOUNT_PASSWORD_RESET_CODE), eq(Map.of()));
        verify(codes, never()).issueFor(any());
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

    private OutgoingMail handedOver() {
        assertThat(handedOver).as("exactly one message is handed over").hasSize(1);
        return handedOver.getFirst();
    }

    private void compose() {
        mailer.compose(new QueuedMessage(ACCOUNT, MessageKind.ACCOUNT_PASSWORD_RESET_CODE, Map.of()),
                handedOver::add);
    }

    @Test
    void givenADeactivatedAccount_whenItsCodeIsComposed_thenNoCodeIsIssuedAndTheReasonIsNamed() {
        // given
        reachable(false, ADDRESS);

        // when / then
        assertThatThrownBy(this::compose)
                .isInstanceOf(MessageUndeliverableException.class)
                .satisfies(failure -> assertThat(((MessageUndeliverableException) failure).reason())
                        .isEqualTo("RecipientUnreachable"));
        verify(codes, never()).issueFor(any());
    }

    private void reachable(boolean enabled, String address) {
        Person person = mock(Person.class);
        when(person.getEmail()).thenReturn(address);
        UserAccount account = mock(UserAccount.class);
        when(account.isEnabled()).thenReturn(enabled);
        when(account.getPerson()).thenReturn(person);
        when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(account));
    }

    private void club(String defaultLocale) {
        when(club.clubName()).thenReturn("Example Tennis Club");
        when(club.defaultLocale()).thenReturn(defaultLocale);
        when(club.zoneId()).thenReturn(ZONE);
    }

    private void issues(String recipientLocale) {
        reachable(true, ADDRESS);
        when(codes.issueFor(ACCOUNT)).thenReturn(new IssuedResetCode(
                ADDRESS, "Jane", recipientLocale, "doe.jane", CODE, EXPIRES_AT));
    }
}
