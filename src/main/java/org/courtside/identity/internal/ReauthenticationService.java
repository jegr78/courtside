package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.RecentAuthentication;
import org.courtside.identity.UserAccount;
import org.courtside.shared.SecurityEventLog;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
class ReauthenticationService {

    private final CurrentUser currentUser;
    private final PasswordEncoder passwordEncoder;
    private final RecentAuthentication recentAuthentication;
    private final SecurityEventLog securityEvents;

    void reauthenticate(String password) {
        UserAccount account = currentUser.requireAccount();
        if (password == null || account.getPasswordHash() == null
                || !passwordEncoder.matches(password, account.getPasswordHash())) {
            securityEvents.controlRefused(account.getId(),
                    SecurityEventLog.ControlRefusal.REAUTHENTICATION_FAILED);
            throw new ReauthenticationFailedException();
        }
        recentAuthentication.renew();
    }
}
