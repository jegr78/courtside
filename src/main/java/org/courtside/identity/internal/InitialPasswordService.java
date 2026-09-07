package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.AccountSessions;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.SecurityEventLog;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
class InitialPasswordService {

    private final CurrentUser currentUser;
    private final UserAccountRepository accounts;
    private final PasswordEncoder passwordEncoder;
    private final AccountSessions sessions;
    private final PasswordPolicy policy;
    private final SecurityEventLog securityEvents;

    @Transactional
    void change(String password) {
        UserAccount account = currentUser.requireAccount();
        policy.requireUnguessable(password, account);
        String passwordHash = passwordEncoder.encode(password);
        if (accounts.changeInitialPassword(account.getId(), passwordHash) != 1) {
            throw new IllegalStateException("The initial password was already changed");
        }
        sessions.endFor(account.getUsername());
        securityEvents.credentialChangedAfterCommit(account.getId(), account.getId(),
                SecurityEventLog.CredentialChange.PERMANENT_PASSWORD_REPLACED);
    }
}
