package org.courtside.identity;

import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

@Component
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class CurrentUser {

    private final UserAccountRepository accounts;

    public Optional<UserAccount> account() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        // The anonymous token reports isAuthenticated() == true, so without this an anonymous
        // caller would be looked up as "anonymousUser".
        if (authentication == null || !authentication.isAuthenticated()
                || authentication instanceof AnonymousAuthenticationToken) {
            return Optional.empty();
        }
        return accounts.findByUsername(authentication.getName());
    }

    public Optional<UserAccount> accountReadyForUse() {
        return account().filter(account -> !account.isPasswordChangeRequired());
    }

    public UserAccount requireAccount() {
        return account().orElseThrow(() -> new IllegalStateException("No authenticated account"));
    }
}
