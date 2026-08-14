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

import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CourtsideUserDetailsServiceTest {

    @Mock
    private UserAccountRepository accounts;

    @Test
    void givenTheRehashWriteFails_whenUpdatingThePassword_thenTheLoginStillSucceeds() {
        // given
        UserAccount account = new UserAccount(new Person("Jane", "Doe", "jane.doe@example.org"),
                "doe.jane", "old-hash", Set.of(Role.MEMBER));
        UserDetails user = User.withUsername("doe.jane")
                .password("old-hash")
                .authorities("ROLE_MEMBER")
                .build();
        when(accounts.findByUsername("doe.jane")).thenReturn(Optional.of(account));
        when(accounts.rehashPassword(account.getId(), "old-hash", "new-hash"))
                .thenThrow(new DataAccessResourceFailureException("read-only replica"));
        CourtsideUserDetailsService service = new CourtsideUserDetailsService(accounts);

        // when / then
        assertThatCode(() -> {
            UserDetails result = service.updatePassword(user, "new-hash");
            assertThat(result).isSameAs(user);
        }).doesNotThrowAnyException();
    }
}
