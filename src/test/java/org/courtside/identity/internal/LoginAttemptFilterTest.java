package org.courtside.identity.internal;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.web.util.matcher.RequestMatcher;

import java.time.Duration;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
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

    private final RequestMatcher loginEndpoint = request -> true;

    @Test
    void givenVerificationCapacityIsOccupied_whenLoginArrives_thenItReceivesTheTypedLimit()
            throws Exception {
        // given
        LoginVerificationCapacity capacity = capacity(1);
        when(protection.registerAttempt(anyString())).thenReturn(Optional.empty());

        // when
        try (LoginVerificationCapacity.Permit ignored = capacity.tryAcquire().orElseThrow()) {
            filter(capacity).doFilter(new MockHttpServletRequest(), new MockHttpServletResponse(), chain);
        }

        // then
        verify(handler).handle(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.eq(Duration.ofSeconds(1)));
        verify(chain, never()).doFilter(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any());
    }

    @Test
    void givenAuthenticationThrows_whenTheNextLoginArrives_thenCapacityWasStillReleased()
            throws Exception {
        // given
        LoginVerificationCapacity capacity = capacity(1);
        when(protection.registerAttempt(anyString())).thenReturn(Optional.empty());
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

    private LoginAttemptFilter filter(LoginVerificationCapacity capacity) {
        return new LoginAttemptFilter(loginEndpoint, protection, capacity, handler);
    }

    private static LoginVerificationCapacity capacity(int permits) {
        return new LoginVerificationCapacity(new LoginProtectionProperties(
                new LoginProtectionProperties.Limit(20, Duration.ofMinutes(1), Duration.ofMinutes(1)),
                new LoginProtectionProperties.Observation(100, Duration.ofMinutes(1)), permits));
    }
}
