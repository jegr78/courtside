package org.courtside.identity;

import org.courtside.identity.internal.CredentialIssuing;
import org.courtside.shared.CredentialsRequested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class AccountCredentialsTest {

    private static final Instant NOW = Instant.parse("2026-08-23T10:00:00Z");

    private final UserAccountRepository accounts = mock(UserAccountRepository.class);
    private final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
    private final CredentialIssuing issuing = mock(CredentialIssuing.class);
    private final AccountCredentials credentials = new AccountCredentials(accounts, issuing, events,
            Clock.fixed(NOW, ZoneOffset.UTC));

    @Test
    void givenAnAccountThatWasNeverIssuedOne_whenIssuing_thenItIsStillAnInvitation() {
        // given
        UUID accountId = holding(awaiting());

        // when
        credentials.issueTo(accountId);

        // then
        assertThat(published().reason()).isEqualTo(CredentialsRequested.Reason.NEW_ACCOUNT);
    }

    @Test
    void givenAMemberWhoChoseTheirOwnPassword_whenIssuing_thenItIsAReset() {
        // given
        UUID accountId = holding(enabled(new UserAccount(person(), "doe.jane", "their-own-hash",
                Set.of(Role.MEMBER), "de")));

        // when
        credentials.issueTo(accountId);

        // then
        assertThat(published().reason()).isEqualTo(CredentialsRequested.Reason.PASSWORD_RESET);
    }

    @Test
    void givenACredentialAlreadyOutAndUnused_whenIssuingAgain_thenItIsStillAnInvitation() {
        // given
        UserAccount account = awaiting();
        account.credentialsIssued("a-hash", NOW.plusSeconds(3600));
        UUID accountId = holding(account);

        // when
        credentials.issueTo(accountId);

        // then — nobody shortens a member's window by pressing twice
        assertThat(published().reason()).isEqualTo(CredentialsRequested.Reason.NEW_ACCOUNT);
    }

    @Test
    void givenAnInvitationThatRanOut_whenIssuingAgain_thenItIsStillAnInvitation() {
        // given
        UserAccount account = awaiting();
        account.credentialsIssued("a-hash", NOW.minusSeconds(1));
        UUID accountId = holding(account);

        // when
        credentials.issueTo(accountId);

        // then
        assertThat(published().reason()).isEqualTo(CredentialsRequested.Reason.NEW_ACCOUNT);
    }

    @Test
    void givenADeactivatedAccount_whenIssuing_thenNothingIsSentToSomebodyWhoseAccessEnded() {
        // given
        UserAccount account = awaiting();
        account.disable();
        UUID accountId = holding(account);

        // when / then
        assertThatThrownBy(() -> credentials.issueTo(accountId))
                .isInstanceOf(AccountDeactivatedException.class);
        verifyNoInteractions(events, issuing);
    }

    @Test
    void givenTheAccountHasBeenSentTooMany_whenIssuingAgain_thenNothingIsPublished() {
        // given
        UUID accountId = holding(awaiting());
        org.mockito.Mockito.doThrow(new IllegalStateException("refused by the limit"))
                .when(issuing).registerOrRefuse(accountId);

        // when / then — the limit decides before an event exists, so nothing is half done
        assertThatThrownBy(() -> credentials.issueTo(accountId))
                .isInstanceOf(IllegalStateException.class);
        verifyNoInteractions(events);
    }

    @Test
    void givenAnAccountWhosePersonHasNoAddress_whenIssuing_thenItIsRefusedWhereTheBoardCanSeeIt() {
        // given
        UserAccount account = enabled(UserAccount.awaitingCredentials(
                new Person("Jane", "Doe", ""), "doe.jane", Set.of(Role.MEMBER), "de"));
        UUID accountId = holding(account);

        // when / then — the message is handed over on another thread, so a failure there reaches nobody
        assertThatThrownBy(() -> credentials.issueTo(accountId))
                .isInstanceOf(AccountAddressMissingException.class);
        verifyNoInteractions(events, issuing);
    }

    private CredentialsRequested published() {
        ArgumentCaptor<Object> event = ArgumentCaptor.forClass(Object.class);
        verify(events).publishEvent(event.capture());
        return (CredentialsRequested) event.getValue();
    }

    private UUID holding(UserAccount account) {
        when(accounts.findById(account.getId())).thenReturn(Optional.of(account));
        return account.getId();
    }

    private static UserAccount awaiting() {
        return enabled(UserAccount.awaitingCredentials(person(), "doe.jane", Set.of(Role.MEMBER), "de"));
    }

    private static UserAccount enabled(UserAccount account) {
        account.enable();
        return account;
    }

    private static Person person() {
        return new Person("Jane", "Doe", "jane.doe@example.org");
    }
}
