package org.courtside.identity.internal;

import org.courtside.identity.UserAccountRepository;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.authentication.event.AuthenticationFailureBadCredentialsEvent;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SignInFailureLogUnitTest {

    @Test
    void givenTheAccountCannotBeRead_whenASignInIsRefused_thenTheLogGivesUpRatherThanThrowing() {
        // given — the listener runs inside the sign-in it only observes
        UserAccountRepository accounts = mock(UserAccountRepository.class);
        when(accounts.findByUsername(anyString()))
                .thenThrow(new DataAccessResourceFailureException("no connection"));

        // when / then
        assertThatCode(() -> new SignInFailureLog(accounts).on(refusalFor("doe.jane")))
                .doesNotThrowAnyException();
    }

    private static AuthenticationFailureBadCredentialsEvent refusalFor(String username) {
        return new AuthenticationFailureBadCredentialsEvent(
                new UsernamePasswordAuthenticationToken(username, "wrong"),
                new BadCredentialsException("Bad credentials"));
    }
}
