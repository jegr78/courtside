package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.identity.UserAccountRepository;
import org.springframework.context.event.EventListener;
import org.springframework.security.authentication.event.AbstractAuthenticationFailureEvent;
import org.springframework.security.authentication.event.AuthenticationFailureBadCredentialsEvent;
import org.springframework.security.authentication.event.AuthenticationFailureCredentialsExpiredEvent;
import org.springframework.security.authentication.event.AuthenticationFailureDisabledEvent;
import org.springframework.security.authentication.event.AuthenticationFailureLockedEvent;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;

@Slf4j
@Component
@RequiredArgsConstructor
class SignInFailureLog {

    private final UserAccountRepository accounts;

    @EventListener
    void on(AbstractAuthenticationFailureEvent event) {
        accountOf(event)
                .ifPresentOrElse(id -> log.info("A sign-in was refused as {} for account {}",
                                reasonOf(event), id),
                        () -> log.info("A sign-in was refused as {} for a username nothing is stored under",
                                reasonOf(event)));
    }

    private Optional<UUID> accountOf(AbstractAuthenticationFailureEvent event) {
        return Optional.ofNullable(event.getAuthentication().getName())
                .flatMap(accounts::findByUsername)
                .map(account -> account.getId());
    }

    private static String reasonOf(AbstractAuthenticationFailureEvent event) {
        return switch (event) {
            case AuthenticationFailureBadCredentialsEvent ignored -> "BAD_CREDENTIALS";
            case AuthenticationFailureDisabledEvent ignored -> "DISABLED";
            case AuthenticationFailureLockedEvent ignored -> "LOCKED";
            case AuthenticationFailureCredentialsExpiredEvent ignored -> "CREDENTIALS_EXPIRED";
            default -> event.getClass().getSimpleName();
        };
    }
}
