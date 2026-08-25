package org.courtside.identity.internal;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Optional;

@RequiredArgsConstructor
class LoginAttemptFilter extends OncePerRequestFilter {

    private final RequestMatcher loginEndpoint;
    private final LoginAttemptProtection protection;
    private final LoginRateLimitHandler handler;

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !loginEndpoint.matches(request);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        Optional<LoginBlock> blocked = protection.registerAttempt(request.getRemoteAddr());
        if (blocked.isPresent()) {
            handler.handle(response, blocked.orElseThrow().retryAfter());
            return;
        }
        filterChain.doFilter(request, response);
    }
}
