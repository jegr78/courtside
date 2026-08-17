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

    public void revoke(UserAccount account) {
        account.revokeSessions();
        endFor(account.getUsername());
    }

    public void endIfRevoked(UserAccount account, String principal, long epochBefore) {
        if (account.getSecurityEpoch() != epochBefore) {
            endFor(principal);
        }
    }

    private void delete(String username) {
        try {
            sessions.findByPrincipalName(username).keySet().forEach(sessions::deleteById);
        } catch (RuntimeException failure) {
            log.warn("Could not delete the stored sessions of a revoked account", failure);
        }
    }
}
