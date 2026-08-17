package org.courtside.identity.internal;

import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;

import java.util.List;
import java.util.UUID;

final class CourtsideUserDetails extends User {

    private final UUID accountId;
    private final long securityEpoch;

    CourtsideUserDetails(UUID accountId, String username, String password, boolean enabled,
                         List<String> authorities, long securityEpoch) {
        super(username, password, enabled, true, true, true,
                authorities.stream().map(SimpleGrantedAuthority::new).toList());
        this.accountId = accountId;
        this.securityEpoch = securityEpoch;
    }

    UUID accountId() {
        return accountId;
    }

    long securityEpoch() {
        return securityEpoch;
    }
}
