package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.RecentAuthentication;
import org.courtside.identity.UserAccount;
import org.courtside.shared.SecurityEventLog;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import jakarta.servlet.http.HttpServletRequest;

@Service
@RequiredArgsConstructor
class ReauthenticationService {

    private final CurrentUser currentUser;
    private final PasswordEncoder passwordEncoder;
    private final RecentAuthentication recentAuthentication;
    private final SecurityEventLog securityEvents;
    private final MfaFactors factors;
    private final HttpServletRequest request;

    void reauthenticate(String password, String code) {
        UserAccount account = currentUser.requireAccount();
        if (password == null || account.getPasswordHash() == null
                || !passwordEncoder.matches(password, account.getPasswordHash())) {
            securityEvents.controlRefused(account.getId(),
                    SecurityEventLog.ControlRefusal.REAUTHENTICATION_FAILED);
            throw new ReauthenticationFailedException();
        }
        if (factors.enabled(account.getId())) {
            MfaFactors.Verification result = factors.verify(account.getId(), code, request.getRemoteAddr());
            if (result == MfaFactors.Verification.LIMITED) throw new PasswordVerificationRateLimitedException();
            if (result != MfaFactors.Verification.VALID) throw new ReauthenticationFailedException();
        }
        recentAuthentication.renew();
    }
}
