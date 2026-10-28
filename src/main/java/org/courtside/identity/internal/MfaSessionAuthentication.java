package org.courtside.identity.internal;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.courtside.identity.RecentAuthentication;
import org.courtside.shared.SecurityEventLog;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.session.SessionRegistry;
import org.springframework.security.web.authentication.session.CompositeSessionAuthenticationStrategy;
import org.springframework.security.web.authentication.session.ConcurrentSessionControlAuthenticationStrategy;
import org.springframework.security.web.authentication.session.RegisterSessionAuthenticationStrategy;
import org.springframework.security.web.authentication.session.SessionFixationProtectionStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfAuthenticationStrategy;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
class MfaSessionAuthentication {
    private final CompositeSessionAuthenticationStrategy sessions;
    private final RecentAuthentication recent;
    private final SecurityEventLog events;
    private final SignInRecorder signIns;

    MfaSessionAuthentication(SessionRegistry registry, CourtsideSessionProperties policy,
                             RecentAuthentication recent, SecurityEventLog events, SignInRecorder signIns,
                             @Value("${server.servlet.session.cookie.secure}") boolean secureCookies) {
        var concurrency = new ConcurrentSessionControlAuthenticationStrategy(registry);
        concurrency.setMaximumSessions(policy.concurrentLimit());
        concurrency.setExceptionIfMaximumExceeded(false);
        sessions = new CompositeSessionAuthenticationStrategy(List.of(concurrency,
                new SessionFixationProtectionStrategy(), new RegisterSessionAuthenticationStrategy(registry),
                new CsrfAuthenticationStrategy(SecurityConfiguration.csrfTokenRepository(secureCookies))));
        this.recent = recent;
        this.events = events;
        this.signIns = signIns;
    }

    void complete(Authentication authentication, HttpServletRequest request, HttpServletResponse response) {
        sessions.onAuthentication(authentication, request, response);
        request.getSession().removeAttribute(MfaLogin.CHALLENGE);
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        new HttpSessionSecurityContextRepository().saveContext(context, request, response);
        var user = (CourtsideUserDetails) authentication.getPrincipal();
        recent.record(request);
        events.authenticationSucceeded(user.accountId());
        signIns.signedIn(user.accountId());
        if (authentication.getAuthorities().stream().anyMatch(authority ->
                CourtsideUserDetailsService.PASSWORD_CHANGE_REQUIRED.equals(authority.getAuthority()))) {
            response.setHeader("X-Courtside-Password-Change-Required", "true");
        }
    }
}
