package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiWebAuthnAssertionCredential;
import org.springframework.transaction.annotation.Transactional;
import org.courtside.identity.RecentAuthentication;
import org.courtside.identity.UserAccount;
import org.courtside.shared.SecurityEventLog;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import jakarta.servlet.http.HttpServletRequest;

@Service
@RequiredArgsConstructor
class ReauthenticationService {

    private final MfaManagement management;
    private final MfaWebAuthnFlow webAuthn;
    private final MfaWebAuthnCodec codec;
    private final PasswordEncoder passwordEncoder;
    private final RecentAuthentication recentAuthentication;
    private final SecurityEventLog securityEvents;
    private final MfaFactors factors;
    private final HttpServletRequest request;

    @Transactional(noRollbackFor = {ReauthenticationFailedException.class, PasswordVerificationRateLimitedException.class})
    void reauthenticate(String password, String code, ApiWebAuthnAssertionCredential credential) {
        UserAccount account = management.currentHolderForUpdate();
        if (password == null || account.getPasswordHash() == null
                || !passwordEncoder.matches(password, account.getPasswordHash())) {
            securityEvents.controlRefused(account.getId(),
                    SecurityEventLog.ControlRefusal.REAUTHENTICATION_FAILED);
            throw new ReauthenticationFailedException();
        }
        if (factors.enabled(account.getId())) {
            if (credential != null && code != null && !code.isBlank()) throw new ReauthenticationFailedException();
            MfaFactors.Verification result = credential == null
                    ? factors.verify(account.getId(), code, request.getRemoteAddr())
                    : webAuthn.verifyReauthentication(account, codec.assertion(credential), request.getRemoteAddr());
            if (result == MfaFactors.Verification.LIMITED) throw new PasswordVerificationRateLimitedException();
            if (result != MfaFactors.Verification.VALID) throw new ReauthenticationFailedException();
        }
        recentAuthentication.renew();
    }
}
