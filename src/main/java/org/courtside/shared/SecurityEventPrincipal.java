package org.courtside.shared;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Optional;
import java.util.UUID;

public interface SecurityEventPrincipal {

    UUID securityEventAccountId();

    static Optional<UUID> currentAccountId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        return authentication != null && authentication.getPrincipal() instanceof SecurityEventPrincipal principal
                ? Optional.of(principal.securityEventAccountId()) : Optional.empty();
    }
}
