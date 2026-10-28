package org.courtside.identity.internal;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.courtside.identity.UserAccount;
import org.courtside.shared.SecurityEventLog;
import org.springframework.security.web.webauthn.api.AuthenticatorAssertionResponse;
import org.springframework.security.web.webauthn.api.AuthenticatorAttestationResponse;
import org.springframework.security.web.webauthn.api.Bytes;
import org.springframework.security.web.webauthn.api.ImmutableCredentialRecord;
import org.springframework.security.web.webauthn.api.PublicKeyCredential;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialCreationOptions;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialRequestOptions;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
class MfaWebAuthnFlow {
    static final String REGISTRATION = "courtside.webauthn-registration";
    static final String REAUTHENTICATION = "courtside.webauthn-reauthentication";
    private final MfaManagement management;
    private final MfaWebAuthn webAuthn;
    private final MfaWebAuthnCodec codec;
    private final MfaChallenges challenges;
    private final MfaFactors factors;
    private final MfaWebAuthnCredentials credentials;
    private final MfaRecoveryCodeRepository recovery;
    private final LoginAttemptProtection attempts;
    private final HttpServletRequest request;

    @Transactional
    Options<PublicKeyCredentialCreationOptions> beginRegistration(String session) {
        UserAccount account = management.currentForChange();
        var options = webAuthn.registrationOptions(account.getId());
        UUID id = challenges.issue(account.getId(), account.getSecurityEpoch(), MfaChallenges.Purpose.WEBAUTHN_REGISTRATION,
                session, codec.encode(options)).orElseThrow(MfaProofFailedException::new);
        return new Options<>(id, options);
    }

    @Transactional
    MfaManagement.Confirmation register(UUID id, String session, PublicKeyCredential<AuthenticatorAttestationResponse> credential,
                                        String label, String address) {
        UserAccount account = management.currentForChange();
        var challenge = challenges.attempt(id, account.getId(), account.getSecurityEpoch(),
                MfaChallenges.Purpose.WEBAUTHN_REGISTRATION, session);
        if (challenge.isEmpty()) return new MfaManagement.Confirmation(false, false, List.of());
        String bucket = "mfa-enrollment:" + account.getId();
        if (attempts.registerCredentialAttempt(bucket, address).isPresent()) {
            return new MfaManagement.Confirmation(false, true, List.of());
        }
        boolean enabled = factors.enabled(account.getId());
        var options = codec.decode(challenge.get().payload(), PublicKeyCredentialCreationOptions.class);
        if (!webAuthn.register(account.getId(), options, credential, label)) {
            return new MfaManagement.Confirmation(false, false, List.of());
        }
        if (!challenges.consume(id)) throw new MfaProofFailedException();
        attempts.clearCredentialAccountAttempt(bucket);
        return new MfaManagement.Confirmation(true, false, management.activated(account, enabled));
    }

    @Transactional
    Options<PublicKeyCredentialRequestOptions> beginReauthentication(String session) {
        UserAccount account = management.currentHolderForUpdate();
        var options = webAuthn.authenticationOptions(account.getId());
        UUID id = challenges.issue(account.getId(), account.getSecurityEpoch(), MfaChallenges.Purpose.REAUTHENTICATION,
                session, codec.encode(options)).orElseThrow(MfaProofFailedException::new);
        return new Options<>(id, options);
    }

    MfaFactors.Verification verifyReauthentication(UserAccount account,
                        PublicKeyCredential<AuthenticatorAssertionResponse> credential, String address) {
        var session = request.getSession(false);
        if (session == null || !(session.getAttribute(REAUTHENTICATION) instanceof UUID id)) return MfaFactors.Verification.INVALID;
        var challenge = challenges.attempt(id, account.getId(), account.getSecurityEpoch(),
                MfaChallenges.Purpose.REAUTHENTICATION, session.getId());
        if (challenge.isEmpty()) return MfaFactors.Verification.INVALID;
        var result = factors.verifyWebAuthn(account.getId(),
                codec.decode(challenge.get().payload(), PublicKeyCredentialRequestOptions.class), credential, address);
        if (result == MfaFactors.Verification.VALID && !challenges.consume(id)) throw new MfaProofFailedException();
        return result;
    }

    @Transactional
    void remove(String id) {
        UserAccount account = management.currentForChange();
        var credential = ownCredential(account, id);
        credentials.delete(credential.getCredentialId());
        if (!factors.enabled(account.getId())) recovery.clear(account.getId());
        management.changed(account, SecurityEventLog.CredentialChange.MFA_METHOD_CHANGED);
    }

    @Transactional
    void rename(String id, String label) {
        UserAccount account = management.currentForChange();
        if (label == null || label.isBlank() || label.length() > 100 || label.codePoints().anyMatch(Character::isISOControl)) {
            throw new MfaProofFailedException();
        }
        credentials.save(ImmutableCredentialRecord.fromCredentialRecord(ownCredential(account, id)).label(label).build());
        management.changed(account, SecurityEventLog.CredentialChange.MFA_METHOD_CHANGED);
    }

    private org.springframework.security.web.webauthn.api.CredentialRecord ownCredential(UserAccount account, String id) {
        Bytes key;
        try { key = Bytes.fromBase64(id); }
        catch (IllegalArgumentException invalid) { throw new MfaProofFailedException(); }
        var credential = credentials.findByCredentialId(key);
        if (credential == null || !credential.getUserEntityUserId().equals(MfaWebAuthnUsers.handle(account.getId()))) {
            throw new MfaResourceNotFoundException();
        }
        return credential;
    }

    record Options<T>(UUID id, T options) { }
}
