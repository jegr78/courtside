package org.courtside.identity;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
@Slf4j
@RequiredArgsConstructor
public class AccountSessions {

    private final FindByIndexNameSessionRepository<? extends Session> sessions;

    // After the commit, because the session store commits on its own and an operation that is
    // still refused afterwards would otherwise have signed somebody out for nothing.
    public void endFor(String username) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            delete(username);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                delete(username);
            }
        });
    }

    // Best effort: the account's security epoch is what refuses the next request, so a stored row
    // that outlives its deletion is untidy rather than dangerous.
    private void delete(String username) {
        try {
            sessions.findByPrincipalName(username).keySet().forEach(sessions::deleteById);
        } catch (RuntimeException failure) {
            log.warn("Could not delete the stored sessions of a revoked account", failure);
        }
    }
}
