package org.courtside.identity.internal;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.courtside.shared.SecurityEventLog;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

class AbsoluteSessionLifetimeFilter extends OncePerRequestFilter {

    private final Clock clock;
    private final Duration lifetime;
    private final SecurityEventLog securityEvents;

    // The system clock, because Spring Session writes the creation time from it and the
    // application's own is a fixed instant under test.
    AbsoluteSessionLifetimeFilter(Duration lifetime, SecurityEventLog securityEvents) {
        this(Clock.systemUTC(), lifetime, securityEvents);
    }

    AbsoluteSessionLifetimeFilter(Clock clock, Duration lifetime, SecurityEventLog securityEvents) {
        this.clock = clock;
        this.lifetime = lifetime;
        this.securityEvents = securityEvents;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        HttpSession session = request.getSession(false);
        if (session != null
                && !Instant.ofEpochMilli(session.getCreationTime()).plus(lifetime).isAfter(clock.instant())) {
            Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
            session.invalidate();
            SecurityContextHolder.clearContext();
            if (authentication != null && authentication.getPrincipal() instanceof CourtsideUserDetails user) {
                securityEvents.sessionTerminated(user.accountId(), null,
                        SecurityEventLog.SessionTermination.ABSOLUTE_EXPIRY);
            }
        }
        // Carried on rather than answered here: this request may be the sign-in that replaces it.
        filterChain.doFilter(request, response);
    }
}
