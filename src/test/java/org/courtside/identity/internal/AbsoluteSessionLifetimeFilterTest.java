package org.courtside.identity.internal;

import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterEach;
import org.courtside.shared.SecurityEventLog;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class AbsoluteSessionLifetimeFilterTest {

    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");
    private static final Duration LIFETIME = Duration.ofHours(24);

    private final HttpServletRequest request = mock(HttpServletRequest.class);
    private final HttpServletResponse response = mock(HttpServletResponse.class);
    private final FilterChain chain = mock(FilterChain.class);
    private final SecurityEventLog securityEvents = mock(SecurityEventLog.class);

    private final AbsoluteSessionLifetimeFilter filter = new AbsoluteSessionLifetimeFilter(
            Clock.fixed(NOW, ZoneOffset.UTC), LIFETIME, securityEvents);

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void givenASessionOlderThanTheLifetime_whenARequestArrives_thenItIsEndedAndCarriedOn() throws Exception {
        // given
        HttpSession session = sessionCreated(LIFETIME.plusSeconds(1));
        UUID accountId = authenticate();

        // when
        filter.doFilter(request, response, chain);

        // then
        verify(session).invalidate();
        verify(securityEvents).sessionTerminated(accountId, null,
                SecurityEventLog.SessionTermination.ABSOLUTE_EXPIRY);
        // The request carries on without authority: what needs it answers 401 the ordinary way, and
        // signing in again is a request an aged session must not stand in the way of.
        verify(chain).doFilter(request, response);
    }

    @Test
    void givenASessionAtTheLifetimeToTheSecond_whenARequestArrives_thenItIsAlreadyOver() throws Exception {
        // given
        HttpSession session = sessionCreated(LIFETIME);

        // when
        filter.doFilter(request, response, chain);

        // then — the lifetime is how long a session may live, so reaching it ends it
        verify(session).invalidate();
        verify(chain).doFilter(request, response);
    }

    @Test
    void givenASessionInsideTheLifetime_whenARequestArrives_thenItIsServed() throws Exception {
        // given
        HttpSession session = sessionCreated(LIFETIME.minusSeconds(1));

        // when
        filter.doFilter(request, response, chain);

        // then
        verify(session, never()).invalidate();
        verify(chain).doFilter(request, response);
    }

    @Test
    void givenNoSession_whenARequestArrives_thenNothingIsRefused() throws Exception {
        // given
        when(request.getSession(false)).thenReturn(null);

        // when
        filter.doFilter(request, response, chain);

        // then
        verify(chain).doFilter(request, response);
    }

    @Test
    void givenTheSessionStoreRefusesExpiry_whenARequestArrives_thenNoTerminationSuccessIsRecorded() {
        // given
        HttpSession session = sessionCreated(LIFETIME.plusSeconds(1));
        authenticate();
        doThrow(new IllegalStateException("store unavailable")).when(session).invalidate();

        // when / then
        assertThatThrownBy(() -> filter.doFilter(request, response, chain))
                .isInstanceOf(IllegalStateException.class);
        verifyNoInteractions(securityEvents);
    }

    private HttpSession sessionCreated(Duration ago) {
        HttpSession session = mock(HttpSession.class);
        when(session.getCreationTime()).thenReturn(NOW.minus(ago).toEpochMilli());
        when(request.getSession(false)).thenReturn(session);
        return session;
    }

    private static UUID authenticate() {
        UUID accountId = UUID.randomUUID();
        CourtsideUserDetails user = new CourtsideUserDetails(
                accountId, "doe.jane", "password", true, true, List.of("ROLE_MEMBER"), 1L);
        SecurityContextHolder.getContext().setAuthentication(
                UsernamePasswordAuthenticationToken.authenticated(
                        user, user.getPassword(), user.getAuthorities()));
        return accountId;
    }
}
