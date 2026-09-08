package org.courtside.identity.internal;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.courtside.identity.CurrentUser;
import org.courtside.shared.SecurityEventLog;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.util.Optional;

@RequiredArgsConstructor
class LoginAttemptFilter extends OncePerRequestFilter {

    enum Kind { LOGIN, CREDENTIAL }

    private final Kind kind;
    private final RequestMatcher handledEndpoints;
    private final LoginAttemptProtection protection;
    private final LoginVerificationCapacity loginVerificationCapacity;
    private final LoginVerificationCapacity credentialVerificationCapacity;
    private final LoginRateLimitHandler handler;
    private final SecurityEventLog securityEvents;
    private final CurrentUser currentUser;

    // Both instances are this class, and the inherited name would let whichever ran first mark the
    // request as filtered for the other.
    @Override
    protected String getAlreadyFilteredAttributeName() {
        return getClass().getName() + "." + kind + ".FILTERED";
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !handledEndpoints.matches(request);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        boolean login = kind == Kind.LOGIN;
        String address = request.getRemoteAddr();
        String accountId = currentUser.accountId().map(Object::toString).orElse("anonymous");
        String loginAddress = "login:" + address;
        Optional<LoginBlock> blocked = login
                ? protection.registerAttempt(loginAddress, true,
                        SecurityEventLog.ControlTrigger.LOGIN_ADDRESS_LIMIT)
                : protection.registerCredentialAttempt(accountId, address);
        if (blocked.isPresent()) {
            handler.handle(response, blocked.orElseThrow().retryAfter(), login);
            return;
        }
        LoginVerificationCapacity capacity = login
                ? loginVerificationCapacity : credentialVerificationCapacity;
        Optional<LoginVerificationCapacity.Permit> permit = capacity.tryAcquire();
        if (permit.isEmpty()) {
            securityEvents.controlRefused(null,
                    login ? SecurityEventLog.ControlRefusal.LOGIN_VERIFICATION_CAPACITY
                            : SecurityEventLog.ControlRefusal.PASSWORD_VERIFICATION_CAPACITY);
            handler.handle(response, Duration.ofSeconds(1), login);
            return;
        }
        try (LoginVerificationCapacity.Permit ignored = permit.orElseThrow()) {
            filterChain.doFilter(request, response);
            if (response.getStatus() >= 200 && response.getStatus() < 300) {
                if (login) {
                    protection.clear(loginAddress);
                } else {
                    protection.clearCredentialAccountAttempt(accountId);
                }
            }
        }
    }
}
