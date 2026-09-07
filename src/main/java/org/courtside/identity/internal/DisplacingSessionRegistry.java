package org.courtside.identity.internal;

import lombok.extern.slf4j.Slf4j;
import org.courtside.identity.UserAccountRepository;
import org.springframework.security.core.session.SessionInformation;
import org.springframework.security.core.session.SessionRegistry;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.session.security.SpringSessionBackedSessionRegistry;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

@Slf4j
class DisplacingSessionRegistry<S extends Session> implements SessionRegistry {

    private final SessionRegistry stored;
    private final FindByIndexNameSessionRepository<S> sessions;
    private final UserAccountRepository accounts;

    DisplacingSessionRegistry(FindByIndexNameSessionRepository<S> sessions, UserAccountRepository accounts) {
        this.stored = new SpringSessionBackedSessionRegistry<>(sessions);
        this.sessions = sessions;
        this.accounts = accounts;
    }

    @Override
    public List<SessionInformation> getAllSessions(Object principal, boolean includeExpired) {
        // A mutable list, because the strategy that reads this sorts it in place to find the
        // least recently active one.
        return stored.getAllSessions(principal, includeExpired).stream()
                .map(this::endedByDeletion)
                .collect(Collectors.toCollection(ArrayList::new));
    }

    // Spring Session's own registry marks the session instead, which leaves the row and has the next
    // request answered here rather than carried on without authority the way every other end is.
    private SessionInformation endedByDeletion(SessionInformation information) {
        return new SessionInformation(information.getPrincipal(), information.getSessionId(),
                information.getLastRequest()) {
            @Override
            public void expireNow() {
                super.expireNow();
                end(getSessionId(), information.getPrincipal());
            }
        };
    }

    // A store that refuses the deletion must not fail the sign-in that caused it, the way section 10
    // already says of revocation: the bound slides by one and the next sign-in takes it back.
    private void end(String sessionId, Object principal) {
        try {
            sessions.deleteById(sessionId);
            accounts.findByUsername(String.valueOf(principal))
                    .ifPresent(account -> log.info(
                            "A sign-in displaced the least recently active session of account {}",
                            account.getId()));
        } catch (RuntimeException failure) {
            log.warn("A displaced session could not be ended", failure);
        }
    }

    // Nothing in this application ever marks a session expired, which is what lets the two
    // answers below say nothing and what keeps the rewrapped information free of an expiry.
    @Override
    public List<Object> getAllPrincipals() {
        return stored.getAllPrincipals();
    }

    // Nothing is ever marked here, so there is never an expiry to report, and the one caller that
    // asks is the filter checking for exactly that — answering it costs a session read per request.
    @Override
    public SessionInformation getSessionInformation(String sessionId) {
        return null;
    }

    @Override
    public void refreshLastRequest(String sessionId) {
        stored.refreshLastRequest(sessionId);
    }

    @Override
    public void registerNewSession(String sessionId, Object principal) {
        stored.registerNewSession(sessionId, principal);
    }

    @Override
    public void removeSessionInformation(String sessionId) {
        stored.removeSessionInformation(sessionId);
    }
}
