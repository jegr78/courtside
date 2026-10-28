package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.shared.SecurityEventLog;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.web.webauthn.api.AuthenticatorAssertionResponse;
import org.springframework.security.web.webauthn.api.PublicKeyCredential;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialRequestOptions;

import java.time.Clock;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.function.BooleanSupplier;

@Service
@RequiredArgsConstructor
class MfaFactors {
    private final MfaTotpRepository totp;
    private final MfaRecoveryCodeRepository recovery;
    private final LoginAttemptProtection attempts;
    private final JdbcClient jdbc;
    private final SecurityEventLog events;
    private final MfaWebAuthnCredentials credentials;
    private final MfaWebAuthn webAuthn;
    private final Clock clock;

    enum Verification { VALID, INVALID, LIMITED }

    @Transactional(readOnly = true)
    boolean enabled(UUID account) {
        return totp.enabled(account) || credentials.enabled(account);
    }

    @Transactional(readOnly = true)
    boolean recoveryPending(UUID account) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM account_mfa WHERE account_id = :id AND recovery_pending)")
                .param("id", account).query(Boolean.class).single();
    }

    @Transactional
    Verification verify(UUID account, String code, String address) {
        return verify(account, address, () -> totp.verify(account, code) || recovery.consume(account, code));
    }

    @Transactional
    Verification verifyWebAuthn(UUID account, PublicKeyCredentialRequestOptions options,
                               PublicKeyCredential<AuthenticatorAssertionResponse> credential, String address) {
        return verify(account, address, () -> webAuthn.verify(account, options, credential));
    }

    private Verification verify(UUID account, String address, BooleanSupplier proof) {
        if (account == null) throw new IllegalStateException("MFA account is required");
        if (!jdbc.sql("""
                SELECT enabled AND (NOT password_change_required OR credentials_expire_at IS NULL
                    OR credentials_expire_at > :now) FROM user_account WHERE id = :id FOR UPDATE
                """).param("id", account).param("now", clock.instant().atOffset(ZoneOffset.UTC))
                .query(Boolean.class).optional().orElse(false)) return Verification.INVALID;
        if (attempts.registerFactorAttempt(account, address).isPresent()) return Verification.LIMITED;
        boolean available = enabled(account) && !recoveryPending(account);
        if (!available || !proof.getAsBoolean()) {
            if (available) attempts.registerFactorFailure(account);
            events.controlRefused(account, SecurityEventLog.ControlRefusal.MFA_PROOF_FAILED);
            return Verification.INVALID;
        }
        attempts.clearFactorAttempt(account);
        return Verification.VALID;
    }
}
