package org.courtside.identity.internal;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Optional;

@Slf4j
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
            LoginBlock block = blocked.orElseThrow();
            log.info("A sign-in was refused before authentication: the {} limit holds it for another {} seconds",
                    block.scope(), block.retryAfter().toSeconds());
            handler.handle(response, block.retryAfter());
            return;
        }
        filterChain.doFilter(request, response);
    }
}
