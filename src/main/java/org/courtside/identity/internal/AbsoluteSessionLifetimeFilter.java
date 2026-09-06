package org.courtside.identity.internal;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

class AbsoluteSessionLifetimeFilter extends OncePerRequestFilter {

    private final Clock clock;
    private final Duration lifetime;

    // Not the application's clock: Spring Session writes the creation time from the system clock, and
    // a fixed instant on one side of that comparison would make the bound meaningless rather than testable.
    AbsoluteSessionLifetimeFilter(Duration lifetime) {
        this(Clock.systemUTC(), lifetime);
    }

    AbsoluteSessionLifetimeFilter(Clock clock, Duration lifetime) {
        this.clock = clock;
        this.lifetime = lifetime;
    }

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
        // Signing in again is one of the things this request may legitimately be, and what needs
        // authority is refused the way every unauthenticated request is.
        filterChain.doFilter(request, response);
    }
}
