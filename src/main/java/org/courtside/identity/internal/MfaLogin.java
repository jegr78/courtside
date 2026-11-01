package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.security.web.webauthn.api.AuthenticatorAssertionResponse;
import org.springframework.security.web.webauthn.api.PublicKeyCredential;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialRequestOptions;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.SecurityEventLog;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
class MfaLogin {
    static final String CHALLENGE = "courtside.mfa-login-challenge";
    private final MfaChallenges challenges;
    private final MfaFactors factors;
    private final UserAccountRepository accounts;
    private final CourtsideUserDetailsService users;
    private final SecurityEventLog events;
    private final MfaWebAuthn webAuthn;
    private final MfaWebAuthnCodec codec;

    @Transactional
    Optional<UUID> begin(MfaPendingAuthentication pending, String session) {
        return challenges.issue(pending.getPrincipal().account(), pending.getPrincipal().epoch(),
                MfaChallenges.Purpose.LOGIN, session, "");
    }

    @Transactional
    Result complete(MfaPendingAuthentication pending, UUID challenge, String session, String code, String address) {
        var identity = pending.getPrincipal();
        if (challenges.attempt(challenge, identity.account(), identity.epoch(),
                MfaChallenges.Purpose.LOGIN, session).isEmpty()) {
            events.controlRefused(identity.account(), SecurityEventLog.ControlRefusal.MFA_PROOF_FAILED);
            return new Result(null, false);
        }
        MfaFactors.Verification verified = factors.verify(identity.account(), code, address);
        if (verified != MfaFactors.Verification.VALID) {
            return new Result(null, verified == MfaFactors.Verification.LIMITED);
        }
        return finish(pending, challenge);
    }

    @Transactional
    PublicKeyCredentialRequestOptions webAuthnOptions(MfaPendingAuthentication pending, UUID challenge, String session) {
        var identity = pending.getPrincipal();
        var options = webAuthn.authenticationOptions(identity.account());
        if (!challenges.setPayload(challenge, identity.account(), identity.epoch(), MfaChallenges.Purpose.LOGIN,
                session, codec.encode(options))) throw new MfaProofFailedException();
        return options;
    }

    @Transactional
    Result completeWebAuthn(MfaPendingAuthentication pending, UUID id, String session,
                           PublicKeyCredential<AuthenticatorAssertionResponse> credential, String address) {
        var identity = pending.getPrincipal();
        var challenge = challenges.attempt(id, identity.account(), identity.epoch(), MfaChallenges.Purpose.LOGIN, session);
        if (challenge.isEmpty() || challenge.get().payload().isEmpty()) {
            events.controlRefused(identity.account(), SecurityEventLog.ControlRefusal.MFA_PROOF_FAILED);
            return new Result(null, false);
        }
        var verified = factors.verifyWebAuthn(identity.account(),
                codec.decode(challenge.get().payload(), PublicKeyCredentialRequestOptions.class), credential, address);
        if (verified != MfaFactors.Verification.VALID) return new Result(null, verified == MfaFactors.Verification.LIMITED);
        return finish(pending, id);
    }

    private Result finish(MfaPendingAuthentication pending, UUID challenge) {
        var identity = pending.getPrincipal();
        var current = accounts.findById(identity.account()).orElseThrow();
        CourtsideUserDetails user = (CourtsideUserDetails) users.loadUserByUsername(current.getUsername());
        if (!user.accountId().equals(identity.account()) || !user.isEnabled() || !user.isCredentialsNonExpired()
                || user.securityEpoch() != identity.epoch() || !challenges.consume(challenge)) throw new MfaProofFailedException();
        user.eraseCredentials();
        return new Result(UsernamePasswordAuthenticationToken.authenticated(user, null, user.getAuthorities()), false);
    }

    record Result(Authentication authentication, boolean limited) { }
}
