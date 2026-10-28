package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import org.courtside.api.ApiMfaStatus;
import org.courtside.api.ApiTotpEnrollment;
import org.courtside.api.ApiWebAuthnDevice;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.AccountMfaChanged;
import org.courtside.identity.AccountSessions;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.RecentAuthentication;
import org.courtside.identity.UserAccount;
import org.courtside.shared.SecurityEventLog;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.time.ZoneOffset;

@Service
@RequiredArgsConstructor
class MfaManagement {
    private final CurrentUser currentUser;
    private final EntityManager entities;
    private final RecentAuthentication recent;
    private final MfaFactors factors;
    private final MfaTotpRepository totp;
    private final MfaRecoveryCodeRepository recovery;
    private final LoginAttemptProtection attempts;
    private final AccountSessions sessions;
    private final ClubIdentity club;
    private final SecurityEventLog securityEvents;
    private final ApplicationEventPublisher events;
    private final MfaWebAuthnCredentials credentials;
    private final MfaWebAuthn webAuthn;

    @Transactional(readOnly = true)
    ApiMfaStatus status() {
        var account = currentUser.accountId().orElseThrow(MfaProofFailedException::new);
        return new ApiMfaStatus(factors.enabled(account), totp.enabled(account), recovery.remaining(account))
                .webauthnAvailable(webAuthn.available())
                .devices(credentials.findByUserId(MfaWebAuthnUsers.handle(account)).stream().map(device ->
                        new ApiWebAuthnDevice(device.getCredentialId().toBase64UrlString(), device.getLabel(),
                                device.getCreated().atOffset(ZoneOffset.UTC), device.getLastUsed().atOffset(ZoneOffset.UTC))).toList());
    }

    @Transactional
    ApiTotpEnrollment beginTotp() {
        UserAccount account = currentForChange();
        String secret = TotpCodes.encodeSecret(totp.begin(account.getId()));
        String issuer = encoded(club.clubName());
        URI uri = URI.create("otpauth://totp/" + issuer + ":" + encoded(account.getUsername())
                + "?secret=" + secret + "&issuer=" + issuer + "&algorithm=SHA1&digits=6&period=30");
        return new ApiTotpEnrollment(secret, uri);
    }

    @Transactional
    Confirmation confirmTotp(String code, String address) {
        UserAccount account = currentForChange();
        String bucket = "mfa-enrollment:" + account.getId();
        if (attempts.registerCredentialAttempt(bucket, address).isPresent()) {
            return new Confirmation(false, true, List.of());
        }
        boolean previouslyEnabled = factors.enabled(account.getId());
        if (!totp.confirm(account.getId(), code)) {
            securityEvents.controlRefused(account.getId(), SecurityEventLog.ControlRefusal.MFA_PROOF_FAILED);
            return new Confirmation(false, false, List.of());
        }
        attempts.clearCredentialAccountAttempt(bucket);
        List<String> codes = activated(account, previouslyEnabled);
        return new Confirmation(true, false, codes);
    }

    @Transactional
    List<String> replaceRecoveryCodes() {
        UserAccount account = currentForChange();
        if (!factors.enabled(account.getId())) throw new MfaProofFailedException();
        List<String> codes = replaceCodes(account);
        changed(account, SecurityEventLog.CredentialChange.MFA_RECOVERY_CODES_REPLACED);
        return codes;
    }

    @Transactional
    void removeTotp() {
        UserAccount account = currentForChange();
        boolean enabled = totp.enabled(account.getId());
        totp.remove(account.getId());
        if (!factors.enabled(account.getId())) recovery.clear(account.getId());
        if (enabled) changed(account, SecurityEventLog.CredentialChange.MFA_METHOD_CHANGED);
    }

    @Transactional
    void disable() {
        UserAccount account = currentForChange();
        boolean enabled = factors.enabled(account.getId());
        totp.remove(account.getId());
        credentials.deleteAll(account.getId());
        recovery.clear(account.getId());
        if (enabled) changed(account, SecurityEventLog.CredentialChange.MFA_DISABLED);
    }

    UserAccount currentForChange() {
        UserAccount account = currentHolderForUpdate();
        recent.requireRecent();
        return account;
    }

    UserAccount currentHolderForUpdate() {
        UserAccount account = currentUser.requireAccount();
        entities.refresh(account, LockModeType.PESSIMISTIC_WRITE);
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof CourtsideUserDetails user)
                || !account.isEnabled() || account.isPasswordChangeRequired()
                || !account.getId().equals(user.accountId())
                || account.getSecurityEpoch() != user.securityEpoch() || factors.recoveryPending(account.getId())) {
            throw new MfaProofFailedException();
        }
        return account;
    }

    List<String> activated(UserAccount account, boolean previouslyEnabled) {
        List<String> codes = previouslyEnabled ? List.of() : replaceCodes(account);
        changed(account, previouslyEnabled ? SecurityEventLog.CredentialChange.MFA_METHOD_CHANGED
                : SecurityEventLog.CredentialChange.MFA_ENABLED);
        return codes;
    }

    private List<String> replaceCodes(UserAccount account) {
        List<String> codes = MfaRecoveryCodes.generate();
        recovery.replace(account.getId(), codes);
        return codes;
    }

    void changed(UserAccount account, SecurityEventLog.CredentialChange action) {
        sessions.revoke(account);
        securityEvents.credentialChangedAfterCommit(account.getId(), account.getId(), action);
        events.publishEvent(new AccountMfaChanged(account.getId()));
    }

    private static String encoded(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }

    record Confirmation(boolean accepted, boolean limited, List<String> codes) { }
}
