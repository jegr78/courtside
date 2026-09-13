package org.courtside.identity.internal;

import org.courtside.identity.Person;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.PasswordResetRequested;
import org.courtside.shared.UsernameReminderRequested;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class AccountRecoveryServiceTest {

    private static final String CALLER = "192.0.2.44";

    private final UserAccountRepository accounts = mock(UserAccountRepository.class);
    private final PasswordResetMailLimit mailLimit = mock(PasswordResetMailLimit.class);
    private final PasswordResetTokenService resetTokens = mock(PasswordResetTokenService.class);
    private final LoginAttemptProtection protection = mock(LoginAttemptProtection.class);
    private final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
    private final AccountRecoveryService recovery =
            new AccountRecoveryService(accounts, mailLimit, resetTokens, protection, events);

    @BeforeEach
    void allowTheCaller() {
        when(protection.registerRecoveryAttempt(any(), any())).thenReturn(Optional.empty());
        when(mailLimit.recordWithinWindow(any())).thenReturn(true);
    }

    @Test
    void givenAMemberWhoForgotTheirPassword_whenTheyAskByName_thenACodeIsMailedToThem() {
        // given
        UserAccount account = known("doe.jane", "jane.doe@example.org");

        // when
        recovery.mailAResetCode("doe.jane", CALLER);

        // then
        ArgumentCaptor<Object> published = ArgumentCaptor.forClass(Object.class);
        verify(events).publishEvent(published.capture());
        assertThat(published.getValue())
                .isEqualTo(new PasswordResetRequested(account.getId()));
        verifyNoInteractions(resetTokens);
    }

    @Test
    void givenNoAccountOfThatName_whenSomebodyAsks_thenNothingIsIssuedAndNothingIsRefused() {
        // given
        when(accounts.findByUsername("nobody.here")).thenReturn(Optional.empty());

        // when / then
        assertThatCode(() -> recovery.mailAResetCode("nobody.here", CALLER))
                .doesNotThrowAnyException();
        verifyNoInteractions(mailLimit, resetTokens, events);
    }

    @Test
    void givenADeactivatedAccount_whenItsNameIsAsked_thenNothingIsIssued() {
        // given
        UserAccount account = UserAccount.awaitingCredentials(
                new Person("Jane", "Doe", "jane.doe@example.org"), "doe.jane",
                Set.of(Role.MEMBER), "de");
        when(accounts.findByUsername("doe.jane")).thenReturn(Optional.of(account));

        // when
        recovery.mailAResetCode("doe.jane", CALLER);

        // then
        verifyNoInteractions(mailLimit, resetTokens, events);
    }

    @Test
    void givenAnAccountWhosePersonHasNoAddress_whenItsNameIsAsked_thenNothingIsIssued() {
        // given
        known("doe.jane", "");

        // when
        recovery.mailAResetCode("doe.jane", CALLER);

        // then
        verifyNoInteractions(mailLimit, resetTokens, events);
    }

    @Test
    void givenTheMailboxHasHadEnoughAlready_whenItsMemberAsks_thenTheRefusalStaysInside() {
        // given
        UserAccount account = known("doe.jane", "jane.doe@example.org");
        when(mailLimit.recordWithinWindow(account.getId())).thenReturn(false);

        // when / then — a 429 here would say the guessed name belongs to somebody
        assertThatCode(() -> recovery.mailAResetCode("doe.jane", CALLER))
                .doesNotThrowAnyException();
        verifyNoInteractions(events);
    }

    @Test
    void givenAnAddressTwoAccountsShare_whenItIsAsked_thenBothAreRemindedAndNoPasswordChanges() {
        // given
        UserAccount parent = enabled(account("roe.john", "roe@example.org"));
        UserAccount child = enabled(account("roe.jane", "roe@example.org"));
        when(accounts.findByPersonEmailIgnoringCase("roe@example.org"))
                .thenReturn(List.of(parent, child));

        // when
        recovery.remindOfUsernames("roe@example.org", CALLER);

        // then
        ArgumentCaptor<Object> published = ArgumentCaptor.forClass(Object.class);
        verify(events, org.mockito.Mockito.times(2)).publishEvent(published.capture());
        assertThat(published.getAllValues())
                .containsExactly(new UsernameReminderRequested(parent.getId()),
                        new UsernameReminderRequested(child.getId()));
        verifyNoInteractions(mailLimit, resetTokens);
    }

    @Test
    void givenACallerThatHasAskedTooOften_whenTheyAskAgain_thenTheRequestIsRefused() {
        // given
        when(protection.registerRecoveryAttempt(any(), any()))
                .thenReturn(Optional.of(new LoginBlock("ADDRESS", Duration.ofSeconds(90))));

        // when / then
        assertThatThrownBy(() -> recovery.mailAResetCode("doe.jane", CALLER))
                .isInstanceOf(AccountRecoveryRateLimitedException.class);
        verifyNoInteractions(accounts, mailLimit, resetTokens, events);
    }

    @Test
    void whenAnAddressIsAskedInMixedCase_thenTheWindowSeesOneSubject() {
        // given
        when(accounts.findByPersonEmailIgnoringCase(any())).thenReturn(List.of());

        // when
        recovery.remindOfUsernames("  Roe@Example.ORG ", CALLER);

        // then
        verify(protection).registerRecoveryAttempt(eq("roe@example.org"), eq(CALLER));
    }

    private UserAccount known(String username, String email) {
        UserAccount account = enabled(account(username, email));
        when(accounts.findByUsername(username)).thenReturn(Optional.of(account));
        return account;
    }

    private static UserAccount account(String username, String email) {
        return UserAccount.awaitingCredentials(new Person("Jane", "Doe", email), username,
                Set.of(Role.MEMBER), "de");
    }

    private static UserAccount enabled(UserAccount account) {
        account.enable();
        return account;
    }
}
