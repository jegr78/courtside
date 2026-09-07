package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.SecurityEventLog;
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
    private final SecurityEventLog securityEvents;

    @EventListener
    void on(AbstractAuthenticationFailureEvent event) {
        // Observing a refusal must not turn it into a different answer than the one it earned.
        securityEvents.authenticationFailed(accountOf(event).orElse(null), reasonOf(event));
    }

    private Optional<UUID> accountOf(AbstractAuthenticationFailureEvent event) {
        try {
            return Optional.ofNullable(event.getAuthentication().getName())
                    .flatMap(accounts::findByUsername)
                    .map(account -> account.getId());
        } catch (RuntimeException e) {
            log.warn("A refused sign-in could not be attributed to an account", e);
            return Optional.empty();
        }
    }

    private static SecurityEventLog.AuthenticationFailure reasonOf(AbstractAuthenticationFailureEvent event) {
        return switch (event) {
            case AuthenticationFailureBadCredentialsEvent ignored ->
                    SecurityEventLog.AuthenticationFailure.BAD_CREDENTIALS;
            case AuthenticationFailureDisabledEvent ignored -> SecurityEventLog.AuthenticationFailure.DISABLED;
            case AuthenticationFailureLockedEvent ignored -> SecurityEventLog.AuthenticationFailure.LOCKED;
            case AuthenticationFailureCredentialsExpiredEvent ignored ->
                    SecurityEventLog.AuthenticationFailure.CREDENTIALS_EXPIRED;
            default -> SecurityEventLog.AuthenticationFailure.OTHER;
        };
    }
}
