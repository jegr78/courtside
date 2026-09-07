package org.courtside.identity.internal;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import org.courtside.identity.CurrentUser;
import org.courtside.shared.SecurityEventLog;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.web.util.matcher.RequestMatcher;

import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class LoginAttemptFilterTest {

    @Mock
    private LoginAttemptProtection protection;

    @Mock
    private LoginRateLimitHandler handler;

    @Mock
    private FilterChain chain;

    @Mock
    private SecurityEventLog securityEvents;

    @Mock
    private CurrentUser currentUser;

    private final RequestMatcher loginEndpoint = request -> true;

    @Test
    void givenVerificationCapacityIsOccupied_whenLoginArrives_thenItReceivesTheTypedLimit()
            throws Exception {
        // given
        LoginVerificationCapacity capacity = capacity(1);
        when(protection.registerAttempt(anyString(), anyBoolean(), any())).thenReturn(Optional.empty());

        // when
        try (LoginVerificationCapacity.Permit ignored = capacity.tryAcquire().orElseThrow()) {
            filter(capacity).doFilter(new MockHttpServletRequest(), new MockHttpServletResponse(), chain);
        }

        // then
        verify(handler).handle(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.eq(Duration.ofSeconds(1)),
                org.mockito.ArgumentMatchers.eq(true));
        verify(securityEvents).controlRefused(null,
                SecurityEventLog.ControlRefusal.LOGIN_VERIFICATION_CAPACITY);
        verify(chain, never()).doFilter(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any());
    }

    @Test
    void givenAuthenticationThrows_whenTheNextLoginArrives_thenCapacityWasStillReleased()
            throws Exception {
        // given
        LoginVerificationCapacity capacity = capacity(1);
        when(protection.registerAttempt(anyString(), anyBoolean(), any())).thenReturn(Optional.empty());
        org.mockito.Mockito.doThrow(new ServletException("authentication failed unexpectedly"))
                .when(chain).doFilter(org.mockito.ArgumentMatchers.any(),
                        org.mockito.ArgumentMatchers.any());

        // when
        assertThatThrownBy(() -> filter(capacity).doFilter(
                new MockHttpServletRequest(), new MockHttpServletResponse(), chain))
                .isInstanceOf(ServletException.class);

        // then
        Optional<LoginVerificationCapacity.Permit> recovered = capacity.tryAcquire();
        assertThat(recovered).isPresent();
        recovered.orElseThrow().close();
    }

    @Test
    void givenCredentialProofCapacityIsOccupied_whenLoginArrives_thenLoginKeepsItsReservedCapacity()
            throws Exception {
        // given
        LoginVerificationCapacity loginCapacity = capacity(1);
        LoginVerificationCapacity credentialCapacity = capacity(1);
        when(protection.registerAttempt(anyString(), anyBoolean(), any())).thenReturn(Optional.empty());

        // when
        try (LoginVerificationCapacity.Permit ignored = credentialCapacity.tryAcquire().orElseThrow()) {
            filter(loginCapacity, credentialCapacity)
                    .doFilter(new MockHttpServletRequest(), new MockHttpServletResponse(), chain);
        }

        // then
        verify(chain).doFilter(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any());
    }

    @Test
    void givenPasswordVerificationSucceeds_whenTheResponseCompletes_thenTheAddressLimitIsCleared()
            throws Exception {
        // given
        LoginVerificationCapacity capacity = capacity(1);
        when(protection.registerAttempt(anyString(), anyBoolean(), any())).thenReturn(Optional.empty());
        org.mockito.Mockito.doAnswer(invocation -> {
            ((MockHttpServletResponse) invocation.getArgument(1)).setStatus(204);
            return null;
        }).when(chain).doFilter(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any());
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("192.0.2.10");

        // when
        filter(capacity).doFilter(request, new MockHttpServletResponse(), chain);

        // then
        verify(protection).clear("login:192.0.2.10");
    }

    @Test
    void givenPasswordVerificationIsRefused_whenTheResponseCompletes_thenTheAttemptRemainsCounted()
            throws Exception {
        // given
        LoginVerificationCapacity capacity = capacity(1);
        when(protection.registerAttempt(anyString(), anyBoolean(), any())).thenReturn(Optional.empty());
        org.mockito.Mockito.doAnswer(invocation -> {
            ((MockHttpServletResponse) invocation.getArgument(1)).setStatus(403);
            return null;
        }).when(chain).doFilter(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any());

        // when
        filter(capacity).doFilter(new MockHttpServletRequest(), new MockHttpServletResponse(), chain);

        // then
        verify(protection, never()).clear(anyString());
        verify(protection, never()).clearCredentialAccountAttempt(anyString());
    }

    @Test
    void givenCredentialProofAddressIsBlocked_whenItIsRetried_thenItsOwnProblemIsReturned()
            throws Exception {
        // given
        LoginVerificationCapacity capacity = capacity(1);
        UUID accountId = UUID.randomUUID();
        when(currentUser.accountId()).thenReturn(Optional.of(accountId));
        when(protection.registerCredentialAttempt(anyString(), anyString()))
                .thenReturn(Optional.of(new LoginBlock("ADDRESS", Duration.ofSeconds(30))));
        RequestMatcher noLoginEndpoint = request -> false;
        LoginAttemptFilter filter = new LoginAttemptFilter(noLoginEndpoint, request -> true,
                protection, capacity, capacity(1), handler, securityEvents, currentUser);

        // when
        filter.doFilter(new MockHttpServletRequest(), new MockHttpServletResponse(), chain);

        // then
        verify(protection).registerCredentialAttempt(accountId.toString(), "127.0.0.1");
        verify(handler).handle(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.eq(Duration.ofSeconds(30)),
                org.mockito.ArgumentMatchers.eq(false));
        verify(chain, never()).doFilter(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any());
    }

    private LoginAttemptFilter filter(LoginVerificationCapacity capacity) {
        return filter(capacity, capacity(1));
    }

    private LoginAttemptFilter filter(LoginVerificationCapacity loginCapacity,
                                      LoginVerificationCapacity credentialCapacity) {
        return new LoginAttemptFilter(loginEndpoint, loginEndpoint, protection, loginCapacity,
                credentialCapacity, handler, securityEvents, currentUser);
    }

    private static LoginVerificationCapacity capacity(int permits) {
        return new LoginVerificationCapacity(new LoginProtectionProperties(
                new LoginProtectionProperties.Limit(20, Duration.ofMinutes(1), Duration.ofMinutes(1)),
                new LoginProtectionProperties.Observation(100, Duration.ofMinutes(1)), permits));
    }
}
