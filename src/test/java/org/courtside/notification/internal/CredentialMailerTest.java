package org.courtside.notification.internal;

import org.courtside.config.ClubIdentity;
import org.courtside.config.CredentialValidity;
import org.courtside.identity.Person;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageKind;
import org.courtside.shared.CredentialIssuer;
import org.courtside.shared.CredentialsRequested;
import org.courtside.shared.IssuedCredential;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.RETURNS_DEEP_STUBS;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CredentialMailerTest {

    private static final UUID ACCOUNT = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final ZoneId ZONE = ZoneId.of("Europe/Berlin");
    private static final Instant NOW = Instant.parse("2026-04-24T09:00:00Z");
    private static final String ADDRESS = "jane.doe@example.org";

    private final CredentialIssuer credentials = mock(CredentialIssuer.class);
    private final CredentialValidity validity = mock(CredentialValidity.class);
    private final UserAccountRepository accounts = mock(UserAccountRepository.class);
    private final ClubIdentity club = mock(ClubIdentity.class);
    private final MessageOutbox outbox = mock(MessageOutbox.class);
    private final List<OutgoingMail> handedOver = new ArrayList<>();

    private final CredentialMailer mailer = new CredentialMailer(credentials, validity, accounts, club,
            new MailTemplates(), outbox, mock(JdbcClient.class, RETURNS_DEEP_STUBS), Clock.fixed(NOW, ZONE));

    @Test
    void givenAnAccountWrittenToInEnglish_whenItsCredentialIsSent_thenTheMessageIsInEnglish() {
        // given
        club("de");
        issues("en");

        // when
        compose(ACCOUNT, MessageKind.CREDENTIALS_NEW_ACCOUNT);

        // then — the club default is German, so only the account's own language can produce this
        assertThat(subjectSent()).isEqualTo("Example Tennis Club: Courtside account for Jane");
        assertThat(bodySent()).contains("Hello Jane").contains("May 1, 2026");
    }

    @Test
    void givenAnAccountWrittenToInGerman_whenItsCredentialIsSent_thenTheMessageIsInGerman() {
        // given
        club("en");
        issues("de");

        // when
        compose(ACCOUNT, MessageKind.CREDENTIALS_PASSWORD_RESET);

        // then
        assertThat(subjectSent()).isEqualTo("Example Tennis Club: neue Zugangsdaten für Jane");
        assertThat(bodySent()).contains("Hallo Jane").contains("1. Mai 2026");
    }

    @Test
    void givenAnAccountCarryingNoLanguageOfItsOwn_whenItsCredentialIsSent_thenTheClubDefaultDecides() {
        // given
        club("de");
        issues(null);

        // when
        compose(ACCOUNT, MessageKind.CREDENTIALS_NEW_ACCOUNT);

        // then
        assertThat(subjectSent()).isEqualTo("Example Tennis Club: Courtside-Konto für Jane");
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
        compose(ACCOUNT, MessageKind.CREDENTIALS_NEW_ACCOUNT);
        compose(sibling, MessageKind.CREDENTIALS_NEW_ACCOUNT);

        // then
        assertThat(handedOver).extracting(OutgoingMail::address).containsOnly(ADDRESS);
        assertThat(handedOver).extracting(OutgoingMail::subject)
                .as("one inbox holds both, so the subject is what separates them")
                .containsExactly("Example Tennis Club: Courtside-Konto für Jane",
                        "Example Tennis Club: Courtside-Konto für John");
    }

    private void issuesTo(UUID accountId, String firstName, String username) {
        addressed(accountId, ADDRESS);
        handsOver(accountId, new IssuedCredential(ADDRESS, firstName, "de", username,
                "a-credential", NOW.plus(Duration.ofDays(7))));
    }

    @Test
    void givenTheTwoReasonsAMemberIsWrittenTo_whenTheyAreQueued_thenTheRowCarriesTheMessagesOwnNameAndNoSecret() {
        // when
        mailer.on(new CredentialsRequested(ACCOUNT, CredentialsRequested.Reason.NEW_ACCOUNT));
        mailer.on(new CredentialsRequested(ACCOUNT, CredentialsRequested.Reason.PASSWORD_RESET));

        // then — the template's own key, so a later message joins without identity's vocabulary
        ArgumentCaptor<MessageKind> kinds = ArgumentCaptor.forClass(MessageKind.class);
        ArgumentCaptor<Map<String, String>> parameters = parametersCaptor();
        verify(outbox, org.mockito.Mockito.times(2)).queue(eq(ACCOUNT), kinds.capture(), parameters.capture());
        assertThat(kinds.getAllValues()).containsExactly(
                MessageKind.CREDENTIALS_NEW_ACCOUNT, MessageKind.CREDENTIALS_PASSWORD_RESET);
        assertThat(parameters.getAllValues())
                .as("a credential is generated when the message is written, so nothing waits in the outbox")
                .allSatisfy(stored -> assertThat(stored).isEmpty());
        verify(credentials, never()).issueFor(any(), any(), any());
    }

    @Test
    void givenAnAccountWithoutAnAddress_whenItsCredentialIsComposed_thenNothingIsIssuedAndTheReasonIsNamed() {
        // given
        club("de");
        addressed(ACCOUNT, " ");

        // when / then
        assertThatThrownBy(() -> compose(ACCOUNT, MessageKind.CREDENTIALS_NEW_ACCOUNT))
                .isInstanceOf(MessageUndeliverableException.class)
                .satisfies(failure -> assertThat(((MessageUndeliverableException) failure).reason())
                        .isEqualTo("RecipientUnreachable"));
        verify(credentials, never()).issueFor(any(), any(), any());
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static ArgumentCaptor<Map<String, String>> parametersCaptor() {
        return (ArgumentCaptor) ArgumentCaptor.forClass(Map.class);
    }

    private void compose(UUID accountId, MessageKind kind) {
        mailer.compose(new QueuedMessage(accountId, kind, Map.of()), handedOver::add);
    }

    private void addressed(UUID accountId, String address) {
        Person person = mock(Person.class);
        when(person.getEmail()).thenReturn(address);
        UserAccount account = mock(UserAccount.class);
        when(account.getPerson()).thenReturn(person);
        when(accounts.findById(accountId)).thenReturn(Optional.of(account));
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

    private void club(String defaultLocale) {
        when(club.clubName()).thenReturn("Example Tennis Club");
        when(club.defaultLocale()).thenReturn(defaultLocale);
        when(club.zoneId()).thenReturn(ZONE);
    }

    private void issues(String recipientLocale) {
        addressed(ACCOUNT, ADDRESS);
        when(validity.validFor(any())).thenReturn(Duration.ofDays(7));
        handsOver(ACCOUNT, new IssuedCredential(ADDRESS, "Jane", recipientLocale, "doe.jane",
                "a-credential", NOW.plus(Duration.ofDays(7))));
    }

    private void handsOver(UUID accountId, IssuedCredential issued) {
        doAnswer(invocation -> {
            Consumer<IssuedCredential> handOver = invocation.getArgument(2);
            handOver.accept(issued);
            return null;
        }).when(credentials).issueFor(eq(accountId), any(), any());
    }
}
