package org.courtside.identity.internal;

import org.courtside.identity.AccountSessions;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.Person;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class InitialPasswordServiceTest {

    @Mock private CurrentUser currentUser;
    @Mock private UserAccountRepository accounts;
    @Mock private PasswordEncoder encoder;
    @Mock private AccountSessions sessions;
    @Mock private PasswordPolicy policy;

    @Test
    void givenActiveSessions_whenChangingTheInitialPassword_thenTheyAreEnded() {
        // given
        UserAccount account = new UserAccount(new Person("Ada", "Admin", "admin@localhost.invalid"),
                "admin", "temporary-hash", Set.of(Role.ADMIN), "de");
        account.requirePasswordChange();
        when(currentUser.requireAccount()).thenReturn(account);
        when(encoder.encode("new-permanent-password")).thenReturn("new-hash");
        when(accounts.changeInitialPassword(account.getId(), "new-hash")).thenReturn(1);
        InitialPasswordService service = new InitialPasswordService(currentUser, accounts, encoder, sessions, policy);

        // when
        service.change("new-permanent-password");

        // then
        verify(sessions).endFor("admin");
    }

    @Test
    void givenAnotherSessionAlreadyChangedThePassword_whenChangingIt_thenThePasswordIsNotOverwritten() {
        // given
        UserAccount account = new UserAccount(new Person("Ada", "Admin", "admin@localhost.invalid"),
                "admin", "temporary-hash", Set.of(Role.ADMIN), "de");
        account.requirePasswordChange();
        when(currentUser.requireAccount()).thenReturn(account);
        when(encoder.encode("new-permanent-password")).thenReturn("new-hash");
        when(accounts.changeInitialPassword(account.getId(), "new-hash")).thenReturn(0);
        InitialPasswordService service = new InitialPasswordService(currentUser, accounts, encoder, sessions, policy);

        // when / then
        assertThatThrownBy(() -> service.change("new-permanent-password"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("The initial password was already changed");
        verify(accounts).changeInitialPassword(account.getId(), "new-hash");
    }

    // The policy has to answer before anything is written, or a refused password would still have
    // ended every session of the account and left the member signed out for nothing.
    @Test
    void givenAGuessablePassword_whenChangingTheInitialOne_thenNeitherTheHashNorTheSessionsChange() {
        // given
        UserAccount account = new UserAccount(new Person("Ada", "Admin", "admin@localhost.invalid"),
                "admin", "temporary-hash", Set.of(Role.ADMIN), "de");
        account.requirePasswordChange();
        when(currentUser.requireAccount()).thenReturn(account);
        doThrow(new GuessablePasswordException())
                .when(policy).requireUnguessable("q1w2e3r4t5y6", account);
        InitialPasswordService service =
                new InitialPasswordService(currentUser, accounts, encoder, sessions, policy);

        // when / then
        assertThatThrownBy(() -> service.change("q1w2e3r4t5y6"))
                .isInstanceOf(GuessablePasswordException.class);
        verify(encoder, never()).encode(any());
        verify(accounts, never()).changeInitialPassword(any(), any());
        verify(sessions, never()).endFor(any());
    }
}
