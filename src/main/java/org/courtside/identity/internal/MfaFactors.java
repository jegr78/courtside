package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.shared.SecurityEventLog;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@RequiredArgsConstructor
class MfaFactors {
    private final MfaTotpRepository totp;
    private final MfaRecoveryCodeRepository recovery;
    private final LoginAttemptProtection attempts;
    private final JdbcClient jdbc;
    private final SecurityEventLog events;

    enum Verification { VALID, INVALID, LIMITED }

    @Transactional(readOnly = true)
    boolean enabled(UUID account) {
        return totp.enabled(account);
    }

    @Transactional(readOnly = true)
    boolean recoveryPending(UUID account) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM account_mfa WHERE account_id = :id AND recovery_pending)")
                .param("id", account).query(Boolean.class).single();
    }

    @Transactional
    Verification verify(UUID account, String code, String address) {
        String bucket = "mfa:" + account;
        if (attempts.registerCredentialAttempt(bucket, address).isPresent()) return Verification.LIMITED;
        if (!enabled(account) || recoveryPending(account)
                || (!totp.verify(account, code) && !recovery.consume(account, code))) {
            events.controlRefused(account, SecurityEventLog.ControlRefusal.MFA_PROOF_FAILED);
            return Verification.INVALID;
        }
        attempts.clearCredentialAccountAttempt(bucket);
        return Verification.VALID;
    }
}
