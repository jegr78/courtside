package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import org.springframework.security.core.context.SecurityContextHolder;
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
    private final EntityManager entities;
    private final UserAccountRepository accounts;
    private final PasswordEncoder passwordEncoder;
    private final AccountSessions sessions;
    private final PasswordPolicy policy;
    private final SecurityEventLog securityEvents;
    private final RecoveryAccountGuard recoveryGuard;

    @Transactional
    void change(String password) {
        UserAccount account = currentUser.account().orElseThrow(ReauthenticationFailedException::new);
        entities.refresh(account, LockModeType.PESSIMISTIC_WRITE);
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()
                || !(authentication.getPrincipal() instanceof CourtsideUserDetails principal)
                || !account.getId().equals(principal.accountId()) || !account.getUsername().equals(principal.getUsername())
                || account.getSecurityEpoch() != principal.securityEpoch() || !account.isEnabled()
                || !account.isPasswordChangeRequired()) throw new ReauthenticationFailedException();
        recoveryGuard.lockAndRequireAvailable(account.getId());
        policy.requireUnguessable(password, account);
        String passwordHash = passwordEncoder.encode(password);
        if (accounts.changeInitialPassword(account.getId(), passwordHash) != 1) {
            throw new ReauthenticationFailedException();
        }
        sessions.endFor(account.getUsername());
        securityEvents.credentialChangedAfterCommit(account.getId(), account.getId(),
                SecurityEventLog.CredentialChange.PERMANENT_PASSWORD_REPLACED);
    }
}
