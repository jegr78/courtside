package org.courtside.identity.internal;

import org.courtside.identity.Person;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.transaction.CannotCreateTransactionException;

import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CourtsideUserDetailsServiceTest {

    @Mock
    private UserAccountRepository accounts;

    @Mock
    private PasswordRehashWriter rehashWriter;

    @Test
    void givenTheRehashWriteFails_whenUpdatingThePassword_thenTheUserIsStillReturned() {
        // given
        UserAccount account = new UserAccount(new Person("Jane", "Doe", "jane.doe@example.org"),
                "doe.jane", "old-hash", Set.of(Role.MEMBER));
        UserDetails user = User.withUsername("doe.jane")
                .password("old-hash")
                .authorities("ROLE_MEMBER")
                .build();
        when(accounts.findByUsername("doe.jane")).thenReturn(Optional.of(account));
        doThrow(new DataAccessResourceFailureException("read-only replica"))
                .when(rehashWriter).rehash(account.getId(), "old-hash", "new-hash");
        CourtsideUserDetailsService service = new CourtsideUserDetailsService(accounts, rehashWriter);

        // when / then
        assertThat(service.updatePassword(user, "new-hash"))
                .as("a failed rehash write must leave the authenticated user untouched")
                .isSameAs(user);
    }

    @Test
    void givenTheCollaboratorFailsAtTransactionBegin_whenUpdatingThePassword_thenTheUserIsStillReturned() {
        // given
        UserAccount account = new UserAccount(new Person("Jane", "Doe", "jane.doe@example.org"),
                "doe.jane", "old-hash", Set.of(Role.MEMBER));
        UserDetails user = User.withUsername("doe.jane")
                .password("old-hash")
                .authorities("ROLE_MEMBER")
                .build();
        when(accounts.findByUsername("doe.jane")).thenReturn(Optional.of(account));
        doThrow(new CannotCreateTransactionException("connection pool exhausted"))
                .when(rehashWriter).rehash(account.getId(), "old-hash", "new-hash");
        CourtsideUserDetailsService service = new CourtsideUserDetailsService(accounts, rehashWriter);

        // when / then
        assertThat(service.updatePassword(user, "new-hash"))
                .as("a rehash write that cannot even begin its transaction must leave the user untouched")
                .isSameAs(user);
    }
}
