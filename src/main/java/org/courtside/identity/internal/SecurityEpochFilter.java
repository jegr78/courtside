package org.courtside.identity.internal;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.SecurityEventLog;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

@RequiredArgsConstructor
class SecurityEpochFilter extends OncePerRequestFilter {

    private final UserAccountRepository accounts;
    private final SecurityEventLog securityEvents;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        // A renamed account frees its old name for somebody else to take.
        if (authentication != null && authentication.getPrincipal() instanceof CourtsideUserDetails user
                && accounts.findSecurityEpochById(user.accountId())
                .filter(epoch -> epoch == user.securityEpoch()).isEmpty()) {
            if (request.getSession(false) != null) {
                request.getSession(false).invalidate();
            }
            SecurityContextHolder.clearContext();
            securityEvents.sessionTerminated(user.accountId(), null,
                    SecurityEventLog.SessionTermination.SECURITY_EPOCH_CHANGED);
        }
        // Carried on rather than answered here: this request may be the sign-in that replaces it.
        filterChain.doFilter(request, response);
    }
}
