package org.courtside.identity;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.stereotype.Service;

@Service
@Slf4j
@RequiredArgsConstructor
public class AccountSessions {

    private final FindByIndexNameSessionRepository<? extends Session> sessions;

    // Best effort: the account's security epoch is what refuses the next request, so a stored row
    // that outlives its deletion is untidy rather than dangerous.
    public void endFor(String username) {
        try {
            sessions.findByPrincipalName(username).keySet().forEach(sessions::deleteById);
        } catch (RuntimeException failure) {
            log.warn("Could not delete the stored sessions of a revoked account", failure);
        }
    }
}
