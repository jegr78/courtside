package org.courtside.identity;

import lombok.RequiredArgsConstructor;
import org.courtside.shared.SecurityEventLog;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@RequiredArgsConstructor
public class GlobalSessionAdministration {

    private final UserAccountRepository accounts;
    private final AccountSessions sessions;
    private final CurrentUser currentUser;
    private final RecentAuthentication recentAuthentication;
    private final SecurityEventLog securityEvents;

    @Transactional
    public void endAll() {
        recentAuthentication.requireRecent();
        UUID actorId = currentUser.accountId().orElseThrow();
        for (UserAccount account : accounts.findAll()) {
            sessions.revoke(account);
            securityEvents.sessionTerminatedAfterCommit(account.getId(), actorId,
                    SecurityEventLog.SessionTermination.GLOBAL_REVOKED);
        }
    }
}
