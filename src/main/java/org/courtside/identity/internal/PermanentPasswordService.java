package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import org.courtside.identity.AccountSessions;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.UserAccount;
import org.courtside.identity.RecentAuthentication;
import org.courtside.shared.SecurityEventLog;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
class PermanentPasswordService {

    private final CurrentUser currentUser;
    private final EntityManager entities;
    private final PasswordEncoder passwordEncoder;
    private final PasswordPolicy policy;
    private final AccountSessions sessions;
    private final SecurityEventLog securityEvents;
    private final MfaFactors factors;
    private final RecentAuthentication recent;

    @Transactional
    void change(String currentPassword, String replacement) {
        UserAccount account = currentUser.requireAccountForUpdate();
        entities.refresh(account, LockModeType.PESSIMISTIC_WRITE);
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.getPrincipal() instanceof CourtsideUserDetails user
                && (!account.getId().equals(user.accountId()) || account.getSecurityEpoch() != user.securityEpoch())) {
            throw new ReauthenticationFailedException();
        }
        if (currentPassword == null || account.getPasswordHash() == null
                || !passwordEncoder.matches(currentPassword, account.getPasswordHash())) {
            securityEvents.controlRefused(account.getId(),
                    SecurityEventLog.ControlRefusal.REAUTHENTICATION_FAILED);
            throw new ReauthenticationFailedException();
        }
        if (factors.enabled(account.getId())) recent.requireRecent();
        policy.requireUnguessable(replacement, account);
        account.replacePermanentPassword(passwordEncoder.encode(replacement));
        sessions.endFor(account.getUsername());
        securityEvents.credentialChangedAfterCommit(account.getId(), account.getId(),
                SecurityEventLog.CredentialChange.PERMANENT_PASSWORD_REPLACED);
    }
}
