package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
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
        var current = accounts.findById(identity.account()).orElseThrow();
        CourtsideUserDetails user = (CourtsideUserDetails) users.loadUserByUsername(current.getUsername());
        if (!user.isEnabled() || !user.isCredentialsNonExpired() || user.securityEpoch() != identity.epoch()
                || !challenges.consume(challenge)) return new Result(null, false);
        user.eraseCredentials();
        return new Result(UsernamePasswordAuthenticationToken.authenticated(user, null, user.getAuthorities()), false);
    }

    record Result(Authentication authentication, boolean limited) { }
}
