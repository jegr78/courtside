package org.courtside.identity.internal;

import org.springframework.security.authentication.AbstractAuthenticationToken;

import java.io.Serializable;
import java.security.Principal;
import java.util.List;
import java.util.UUID;

final class MfaPendingAuthentication extends AbstractAuthenticationToken {
    private final Pending principal;

    MfaPendingAuthentication(UUID account, long epoch) {
        super(List.of());
        if (account == null || epoch < 0) throw new IllegalStateException("Pending MFA account is required");
        principal = new Pending(account, epoch);
        super.setAuthenticated(false);
    }

    @Override public Object getCredentials() { return null; }
    @Override public Pending getPrincipal() { return principal; }
    @Override public String getName() { return principal.getName(); }

    @Override
    public void setAuthenticated(boolean authenticated) {
        if (authenticated) throw new IllegalStateException("A pending MFA proof cannot grant authentication");
        super.setAuthenticated(false);
    }

    record Pending(UUID account, long epoch) implements Serializable, Principal {
        @Override public String getName() { return "mfa-pending:" + account; }
    }
}
