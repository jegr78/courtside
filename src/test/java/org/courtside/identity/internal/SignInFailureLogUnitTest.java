package org.courtside.identity.internal;

import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.SecurityEventLog;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.security.authentication.AuthenticationServiceException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.CredentialsExpiredException;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.authentication.LockedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.authentication.event.AbstractAuthenticationFailureEvent;
import org.springframework.security.authentication.event.AuthenticationFailureBadCredentialsEvent;
import org.springframework.security.authentication.event.AuthenticationFailureCredentialsExpiredEvent;
import org.springframework.security.authentication.event.AuthenticationFailureDisabledEvent;
import org.springframework.security.authentication.event.AuthenticationFailureLockedEvent;

import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SignInFailureLogUnitTest {

    @ParameterizedTest
    @MethodSource("failureEvents")
    void givenAnyAuthenticationFailure_whenObserved_thenItUsesTheCataloguedReasonWithoutTheIdentifier(
            AbstractAuthenticationFailureEvent refusal,
            SecurityEventLog.AuthenticationFailure reason) {
        UserAccountRepository accounts = mock(UserAccountRepository.class);
        SecurityEventLog securityEvents = mock(SecurityEventLog.class);

        new SignInFailureLog(accounts, securityEvents).on(refusal);

        verify(securityEvents).authenticationFailed(null, reason);
    }

    @Test
    void givenTheAccountCannotBeRead_whenASignInIsRefused_thenTheLogGivesUpRatherThanThrowing() {
        // given — the listener runs inside the sign-in it only observes
        UserAccountRepository accounts = mock(UserAccountRepository.class);
        SecurityEventLog securityEvents = mock(SecurityEventLog.class);
        when(accounts.findByUsername(anyString()))
                .thenThrow(new DataAccessResourceFailureException("no connection"));

        // when / then
        assertThatCode(() -> new SignInFailureLog(accounts, securityEvents)
                .on(refusalFor("doe.jane")))
                .doesNotThrowAnyException();
        verify(securityEvents).authenticationFailed(
                null, SecurityEventLog.AuthenticationFailure.BAD_CREDENTIALS);
    }

    private static AuthenticationFailureBadCredentialsEvent refusalFor(String username) {
        return new AuthenticationFailureBadCredentialsEvent(
                new UsernamePasswordAuthenticationToken(username, "wrong"),
                new BadCredentialsException("Bad credentials"));
    }

    private static Stream<Arguments> failureEvents() {
        UsernamePasswordAuthenticationToken authentication =
                new UsernamePasswordAuthenticationToken("submitted-identifier", "secret");
        return Stream.of(
                Arguments.of(new AuthenticationFailureBadCredentialsEvent(authentication,
                                new BadCredentialsException("rejected")),
                        SecurityEventLog.AuthenticationFailure.BAD_CREDENTIALS),
                Arguments.of(new AuthenticationFailureDisabledEvent(authentication,
                                new DisabledException("disabled")),
                        SecurityEventLog.AuthenticationFailure.DISABLED),
                Arguments.of(new AuthenticationFailureLockedEvent(authentication,
                                new LockedException("locked")),
                        SecurityEventLog.AuthenticationFailure.LOCKED),
                Arguments.of(new AuthenticationFailureCredentialsExpiredEvent(authentication,
                                new CredentialsExpiredException("expired")),
                        SecurityEventLog.AuthenticationFailure.CREDENTIALS_EXPIRED),
                Arguments.of(new AbstractAuthenticationFailureEvent(authentication,
                                new AuthenticationServiceException("other")) { },
                        SecurityEventLog.AuthenticationFailure.OTHER));
    }
}
