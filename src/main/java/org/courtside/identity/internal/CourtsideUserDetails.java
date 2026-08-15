package org.courtside.identity.internal;

import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;

import java.util.List;

final class CourtsideUserDetails extends User {

    private final long securityEpoch;

    CourtsideUserDetails(String username, String password, boolean enabled,
                         List<String> authorities, long securityEpoch) {
        super(username, password, enabled, true, true, true,
                authorities.stream().map(SimpleGrantedAuthority::new).toList());
        this.securityEpoch = securityEpoch;
    }

    long securityEpoch() {
        return securityEpoch;
    }
}
