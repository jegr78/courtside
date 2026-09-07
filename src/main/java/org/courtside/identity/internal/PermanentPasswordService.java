package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.AccountSessions;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.UserAccount;
import org.courtside.shared.SecurityEventLog;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
class PermanentPasswordService {

    private final CurrentUser currentUser;
    private final PasswordEncoder passwordEncoder;
    private final PasswordPolicy policy;
    private final AccountSessions sessions;
    private final SecurityEventLog securityEvents;

    @Transactional
    void change(String currentPassword, String replacement) {
        UserAccount account = currentUser.requireAccount();
        if (currentPassword == null || account.getPasswordHash() == null
                || !passwordEncoder.matches(currentPassword, account.getPasswordHash())) {
            securityEvents.controlRefused(account.getId(),
                    SecurityEventLog.ControlRefusal.REAUTHENTICATION_FAILED);
            throw new ReauthenticationFailedException();
        }
        policy.requireUnguessable(replacement, account);
        account.replacePermanentPassword(passwordEncoder.encode(replacement));
        sessions.endFor(account.getUsername());
        securityEvents.credentialChangedAfterCommit(account.getId(), account.getId(),
                SecurityEventLog.CredentialChange.PERMANENT_PASSWORD_REPLACED);
    }
}
