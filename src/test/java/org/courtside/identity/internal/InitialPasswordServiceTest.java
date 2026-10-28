package org.courtside.identity.internal;

import org.courtside.identity.AccountSessions;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.Person;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.SecurityEventLog;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterEach;
import jakarta.persistence.EntityManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import java.util.List;
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
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class InitialPasswordServiceTest {

    @Mock private CurrentUser currentUser;
    @Mock private EntityManager entities;
    @Mock private UserAccountRepository accounts;
    @Mock private PasswordEncoder encoder;
    @Mock private AccountSessions sessions;
    @Mock private PasswordPolicy policy;
    @Mock private SecurityEventLog securityEvents;
    @Mock private RecoveryAccountGuard recoveryGuard;

    @Test
    void givenActiveSessions_whenChangingTheInitialPassword_thenTheyAreEnded() {
        // given
        UserAccount account = new UserAccount(new Person("Jane", "Doe", "jane.doe@example.org"),
                "admin", "temporary-hash", Set.of(Role.ADMIN), "de");
        account.requirePasswordChange();
        prepare(account);
        when(encoder.encode("new-permanent-password")).thenReturn("new-hash");
        when(accounts.changeInitialPassword(account.getId(), "new-hash")).thenReturn(1);
        InitialPasswordService service = new InitialPasswordService(
                currentUser, entities, accounts, encoder, sessions, policy, securityEvents, recoveryGuard);

        // when
        service.change("new-permanent-password");

        // then
        verify(sessions).endFor("admin");
        verify(securityEvents).credentialChangedAfterCommit(account.getId(), account.getId(),
                SecurityEventLog.CredentialChange.PERMANENT_PASSWORD_REPLACED);
    }

    @Test
    void givenAnotherSessionAlreadyChangedThePassword_whenChangingIt_thenThePasswordIsNotOverwritten() {
        // given
        UserAccount account = new UserAccount(new Person("Jane", "Doe", "jane.doe@example.org"),
                "admin", "temporary-hash", Set.of(Role.ADMIN), "de");
        account.requirePasswordChange();
        prepare(account);
        when(encoder.encode("new-permanent-password")).thenReturn("new-hash");
        when(accounts.changeInitialPassword(account.getId(), "new-hash")).thenReturn(0);
        InitialPasswordService service = new InitialPasswordService(
                currentUser, entities, accounts, encoder, sessions, policy, securityEvents, recoveryGuard);

        // when / then
        assertThatThrownBy(() -> service.change("new-permanent-password"))
                .isInstanceOf(ReauthenticationFailedException.class);
        verify(accounts).changeInitialPassword(account.getId(), "new-hash");
        verifyNoInteractions(securityEvents);
    }

    @Test
    void givenAGuessablePassword_whenChangingTheInitialOne_thenNeitherTheHashNorTheSessionsChange() {
        // given
        UserAccount account = new UserAccount(new Person("Jane", "Doe", "jane.doe@example.org"),
                "admin", "temporary-hash", Set.of(Role.ADMIN), "de");
        account.requirePasswordChange();
        prepare(account);
        doThrow(new GuessablePasswordException())
                .when(policy).requireUnguessable("q1w2e3r4t5y6", account);
        InitialPasswordService service =
                new InitialPasswordService(
                        currentUser, entities, accounts, encoder, sessions, policy, securityEvents, recoveryGuard);

        // when / then
        assertThatThrownBy(() -> service.change("q1w2e3r4t5y6"))
                .isInstanceOf(GuessablePasswordException.class);
        verify(encoder, never()).encode(any());
        verify(accounts, never()).changeInitialPassword(any(), any());
        verify(sessions, never()).endFor(any());
        verifyNoInteractions(securityEvents);
    }
    @Test
    void givenPendingAccountRecovery_whenInitialPasswordChanges_thenNoPasswordOrSessionIsChanged() {
        // given
        UserAccount account = new UserAccount(new Person("Jane", "Doe", "jane.doe@example.org"),
                "doe.jane", "temporary-hash", Set.of(Role.MEMBER), "en");
        prepare(account);
        doThrow(new ResetCodeInvalidException()).when(recoveryGuard).lockAndRequireAvailable(account.getId());
        InitialPasswordService service = new InitialPasswordService(currentUser, entities, accounts, encoder, sessions,
                policy, securityEvents, recoveryGuard);
        // when / then
        assertThatThrownBy(() -> service.change("another-unusual-password")).isInstanceOf(ResetCodeInvalidException.class);
        verifyNoInteractions(policy, encoder, sessions, securityEvents);
    }

    private void prepare(UserAccount account) {
        account.enable();
        account.requirePasswordChange();
        when(currentUser.account()).thenReturn(java.util.Optional.of(account));
        var principal = new CourtsideUserDetails(account.getId(), account.getUsername(), "unused", true, true,
                List.of("ROLE_MEMBER"), account.getSecurityEpoch());
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities()));
        SecurityContextHolder.setContext(context);
    }

    @AfterEach
    void clearPrincipal() {
        SecurityContextHolder.clearContext();
    }

}
