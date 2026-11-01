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
        if (password == null) throw refused(account);
        if (account.getPasswordHash() == null
                || !passwordEncoder.matches(password, account.getPasswordHash())) {
            throw refused(account);
        }
        if (factors.enabled(account.getId())) {
            MfaFactors.Verification result = verifySecondFactor(account, code, credential);
            if (result == MfaFactors.Verification.LIMITED) throw new PasswordVerificationRateLimitedException();
            if (result != MfaFactors.Verification.VALID) throw new ReauthenticationFailedException();
        }
        recentAuthentication.renew();
    }

    private MfaFactors.Verification verifySecondFactor(UserAccount account, String code,
                                                      ApiWebAuthnAssertionCredential credential) {
        boolean noCode = code == null || code.isBlank();
        if (credential == null && noCode) throw refused(account);
        if (credential == null) {
            return factors.verify(account.getId(), code, request.getRemoteAddr());
        }
        if (!noCode) throw new ReauthenticationFailedException();
        return webAuthn.verifyReauthentication(account, codec.assertion(credential), request.getRemoteAddr());
    }

    private ReauthenticationFailedException refused(UserAccount account) {
        securityEvents.controlRefused(account.getId(), SecurityEventLog.ControlRefusal.REAUTHENTICATION_FAILED);
        return new ReauthenticationFailedException();
    }
}
