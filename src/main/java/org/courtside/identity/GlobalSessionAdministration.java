package org.courtside.identity;

import lombok.RequiredArgsConstructor;
import org.courtside.shared.SecurityEventLog;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
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
        List<UserAccount> holders = accounts.findAll();
        List<UUID> revoked = holders.stream().map(UserAccount::getId).toList();
        List<String> usernames = holders.stream().map(UserAccount::getUsername).toList();
        accounts.revokeEverySession();
        usernames.forEach(sessions::endFor);
        revoked.forEach(accountId -> securityEvents.sessionTerminatedAfterCommit(accountId, actorId,
                SecurityEventLog.SessionTermination.GLOBAL_REVOKED));
    }
}
