package org.courtside.identity;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.courtside.shared.SecurityEventLog;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

@Component
public class RecentAuthentication {

    static final String AUTHENTICATED_AT = "courtside.authenticated-at";

    private final HttpServletRequest request;
    private final Duration window;
    private final Clock clock;
    private final SecurityEventLog securityEvents;

    RecentAuthentication(HttpServletRequest request,
                         @Value("${courtside.session.reauthentication-window}") Duration window,
                         Clock clock, SecurityEventLog securityEvents) {
        this.request = request;
        this.window = window;
        this.clock = clock;
        this.securityEvents = securityEvents;
    }

    public void record() {
        record(request);
    }

    public void renew() {
        if (request.getSession(false) == null) {
            throw new IllegalStateException("A session identifier cannot be renewed without a session");
        }
        request.changeSessionId();
        record();
    }

    public void record(HttpServletRequest authenticatedRequest) {
        authenticatedRequest.getSession(true)
                .setAttribute(AUTHENTICATED_AT, clock.instant().toEpochMilli());
    }

    public void requireRecent() {
        HttpSession session = request.getSession(false);
        Object stored = session == null ? null : session.getAttribute(AUTHENTICATED_AT);
        Instant now = clock.instant();
        if (!(stored instanceof Long milliseconds)) {
            throw refusal();
        }
        Instant authenticatedAt = Instant.ofEpochMilli(milliseconds);
        if (authenticatedAt.isAfter(now)
                || authenticatedAt.plus(window).isBefore(now)) {
            throw refusal();
        }
    }

    private RecentAuthenticationRequiredException refusal() {
        securityEvents.controlRefusedForCurrentAccount(SecurityEventLog.ControlRefusal.RECENT_AUTHENTICATION);
        return new RecentAuthenticationRequiredException();
    }
}
