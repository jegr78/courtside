package org.courtside.identity;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.internal.CourtsideUserDetails;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

@Component
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class CurrentUser {

    private final UserAccountRepository accounts;

    public Optional<UserAccount> account() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        // The anonymous token reports isAuthenticated() == true.
        if (authentication == null || !authentication.isAuthenticated()
                || authentication instanceof AnonymousAuthenticationToken) {
            return Optional.empty();
        }
        return accounts.findByUsername(authentication.getName());
    }

    // From the principal, not from a lookup: at commit time a renamed account no longer answers to
    // the name its own session carries.
    public Optional<UUID> accountId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()
                || authentication instanceof AnonymousAuthenticationToken) {
            return Optional.empty();
        }
        return authentication.getPrincipal() instanceof CourtsideUserDetails details
                ? Optional.of(details.accountId())
                : Optional.empty();
    }

    public Optional<UserAccount> accountReadyForUse() {
        return account().filter(account -> !account.isPasswordChangeRequired());
    }

    public UserAccount requireAccount() {
        return account().orElseThrow(() -> new IllegalStateException("No authenticated account"));
    }
}
