package org.courtside.identity.internal;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

@RequiredArgsConstructor
class AbsoluteSessionLifetimeFilter extends OncePerRequestFilter {

    private final Clock clock;
    private final Duration lifetime;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        HttpSession session = request.getSession(false);
        // The creation time is stored with the session, so a restart finds the same one and the
        // lifetime keeps counting from where it started rather than from the new process.
        if (session != null
                && !Instant.ofEpochMilli(session.getCreationTime()).plus(lifetime).isAfter(clock.instant())) {
            session.invalidate();
            SecurityContextHolder.clearContext();
        }
        // Ending it is enough: what needs authority now answers 401 through the entry point that
        // answers every other unauthenticated request, and signing in again is one of the things
        // this request may legitimately be.
        filterChain.doFilter(request, response);
    }
}
