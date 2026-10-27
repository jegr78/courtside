package org.courtside.identity.internal;

import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;

final class MfaPasswordAuthenticationProvider implements AuthenticationProvider {
    private final AuthenticationProvider passwords;
    private final MfaFactors factors;

    MfaPasswordAuthenticationProvider(AuthenticationProvider passwords, MfaFactors factors) {
        this.passwords = passwords;
        this.factors = factors;
    }

    @Override
    public Authentication authenticate(Authentication authentication) {
        Authentication password = passwords.authenticate(authentication);
        if (!(password.getPrincipal() instanceof CourtsideUserDetails account)) {
            throw new BadCredentialsException("Account authentication was not accepted");
        }
        if (factors.recoveryPending(account.accountId())) {
            throw new BadCredentialsException("Account authentication was not accepted");
        }
        return factors.enabled(account.accountId())
                ? new MfaPendingAuthentication(account.accountId(), account.securityEpoch()) : password;
    }

    @Override
    public boolean supports(Class<?> authentication) {
        return UsernamePasswordAuthenticationToken.class.isAssignableFrom(authentication);
    }
}
