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
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class InitialPasswordServiceTest {

    @Mock private CurrentUser currentUser;
    @Mock private UserAccountRepository accounts;
    @Mock private PasswordEncoder encoder;
    @Mock private AccountSessions sessions;

    @Test
    void givenActiveSessions_whenChangingTheInitialPassword_thenTheyAreEnded() {
        // given
        UserAccount account = new UserAccount(new Person("Ada", "Admin", "admin@localhost.invalid"),
                "admin", "temporary-hash", Set.of(Role.ADMIN));
        account.requirePasswordChange();
        when(currentUser.requireAccount()).thenReturn(account);
        when(encoder.encode("new-permanent-password")).thenReturn("new-hash");
        when(accounts.changeInitialPassword(account.getId(), "new-hash")).thenReturn(1);
        InitialPasswordService service = new InitialPasswordService(currentUser, accounts, encoder, sessions);

        // when
        service.change("new-permanent-password");

        // then
        verify(sessions).endFor("admin");
    }

    @Test
    void givenAnotherSessionAlreadyChangedThePassword_whenChangingIt_thenThePasswordIsNotOverwritten() {
        // given
        UserAccount account = new UserAccount(new Person("Ada", "Admin", "admin@localhost.invalid"),
                "admin", "temporary-hash", Set.of(Role.ADMIN));
        account.requirePasswordChange();
        when(currentUser.requireAccount()).thenReturn(account);
        when(encoder.encode("new-permanent-password")).thenReturn("new-hash");
        when(accounts.changeInitialPassword(account.getId(), "new-hash")).thenReturn(0);
        InitialPasswordService service = new InitialPasswordService(currentUser, accounts, encoder, sessions);

        // when / then
        assertThatThrownBy(() -> service.change("new-permanent-password"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("The initial password was already changed");
        verify(accounts).changeInitialPassword(account.getId(), "new-hash");
    }
}
