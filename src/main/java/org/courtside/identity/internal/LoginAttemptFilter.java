package org.courtside.identity.internal;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpMethod;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.util.Optional;

@RequiredArgsConstructor
class LoginAttemptFilter extends OncePerRequestFilter {

    private final LoginAttemptProtection protection;
    private final LoginRateLimitHandler handler;

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !HttpMethod.POST.matches(request.getMethod())
                || !(request.getContextPath() + "/api/session").equals(request.getRequestURI());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        Optional<Duration> retryAfter = protection.registerAttempt(request.getRemoteAddr());
        if (retryAfter.isPresent()) {
            handler.handle(response, retryAfter.orElseThrow());
            return;
        }
        filterChain.doFilter(request, response);
    }
}
