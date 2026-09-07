package org.courtside.shared;

import lombok.extern.slf4j.Slf4j;
import org.jspecify.annotations.Nullable;
import org.slf4j.event.Level;
import org.slf4j.spi.LoggingEventBuilder;
import org.springframework.stereotype.Component;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Slf4j(topic = "org.courtside.security.events")
@Component
public class SecurityEventLog {

    public void authenticationSucceeded(UUID accountId) {
        write(SecurityEvent.AUTHENTICATION_SUCCEEDED, accountId, null, null, null);
    }

    public void authenticationFailed(@Nullable UUID accountId, AuthenticationFailure reason) {
        write(SecurityEvent.AUTHENTICATION_FAILED, accountId, null, "event.reason", reason);
    }

    public void authorizationDenied(UUID accountId) {
        write(SecurityEvent.AUTHORIZATION_DENIED, accountId, null, null, null);
    }

    public void authorizationDeniedForCurrentAccount() {
        write(SecurityEvent.AUTHORIZATION_DENIED, currentAccountId(), null, null, null);
    }

    public void sessionTerminated(UUID accountId, @Nullable UUID actorAccountId,
                                  SessionTermination reason) {
        write(SecurityEvent.SESSION_TERMINATED, accountId, actorAccountId, "event.reason", reason);
    }

    public void sessionTerminatedAfterCommit(UUID accountId, @Nullable UUID actorAccountId,
                                             SessionTermination reason) {
        afterCommit(() -> sessionTerminated(accountId, actorAccountId, reason));
    }

    public void credentialChanged(UUID accountId, @Nullable UUID actorAccountId,
                                  CredentialChange action) {
        write(SecurityEvent.CREDENTIAL_CHANGED, accountId, actorAccountId, "event.action", action);
    }

    public void credentialChangedAfterCommit(UUID accountId, @Nullable UUID actorAccountId,
                                             CredentialChange action) {
        afterCommit(() -> credentialChanged(accountId, actorAccountId, action));
    }

    public void credentialChangedAfterCommitForCurrentActor(UUID accountId,
                                                            CredentialChange action) {
        credentialChangedAfterCommit(accountId, currentAccountId(), action);
    }

    public void administrativeActionAfterCommit(UUID accountId, @Nullable UUID actorAccountId,
                                                AdministrativeAction action) {
        afterCommit(() -> administrativeAction(accountId, actorAccountId, action));
    }

    private static void afterCommit(Runnable write) {
        if (!TransactionSynchronizationManager.isActualTransactionActive()
                || !TransactionSynchronizationManager.isSynchronizationActive()) {
            throw new IllegalStateException("A security success event requires an active transaction");
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                write.run();
            }
        });
    }

    public void administrativeAction(UUID accountId, @Nullable UUID actorAccountId,
                                     AdministrativeAction action) {
        write(SecurityEvent.ADMINISTRATIVE_SECURITY_ACTION, accountId, actorAccountId,
                "event.action", action);
    }

    public void controlRefused(@Nullable UUID accountId, ControlRefusal reason) {
        write(SecurityEvent.CONTROL_REFUSED, accountId, null, "event.reason", reason);
    }

    public void controlTriggered(@Nullable UUID accountId, ControlTrigger reason) {
        write(SecurityEvent.CONTROL_TRIGGERED, accountId, null, "event.reason", reason);
    }

    public void controlRefusedForCurrentAccount(ControlRefusal reason) {
        controlRefused(currentAccountId(), reason);
    }

    private static @Nullable UUID currentAccountId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        return authentication != null
                && authentication.getPrincipal() instanceof SecurityEventPrincipal principal
                ? principal.securityEventAccountId() : null;
    }

    private static void write(SecurityEvent event, @Nullable UUID accountId,
                              @Nullable UUID actorAccountId, @Nullable String detailKey,
                              @Nullable Enum<?> detail) {
        LoggingEventBuilder entry = log.atLevel(event.level())
                .addKeyValue("event.code", event.code())
                .addKeyValue("event.outcome", event.outcome());
        if (accountId != null) {
            entry.addKeyValue("account.id", accountId.toString());
        }
        if (actorAccountId != null) {
            entry.addKeyValue("actor.account.id", actorAccountId.toString());
        }
        if (detailKey != null && detail != null) {
            entry.addKeyValue(detailKey, detail.name());
        }
        entry.log("Security event");
    }

    public enum AuthenticationFailure {
        BAD_CREDENTIALS,
        DISABLED,
        LOCKED,
        CREDENTIALS_EXPIRED,
        OTHER
    }

    public enum SessionTermination {
        EXPLICIT_LOGOUT,
        ABSOLUTE_EXPIRY,
        SECURITY_EPOCH_CHANGED,
        CONCURRENT_LIMIT,
        USER_REVOKED,
        ADMINISTRATOR_REVOKED,
        GLOBAL_REVOKED
    }

    public enum CredentialChange {
        PERMANENT_PASSWORD_REPLACED,
        TEMPORARY_CREDENTIAL_ISSUED,
        TEMPORARY_CREDENTIAL_WITHDRAWN
    }

    public enum AdministrativeAction {
        ACCOUNT_CREATED,
        ROLES_CHANGED,
        USERNAME_CHANGED,
        CREDENTIAL_REQUESTED,
        ACCOUNT_ENABLED,
        ACCOUNT_DISABLED
    }

    public enum ControlRefusal {
        CSRF,
        LOGIN_VERIFICATION_CAPACITY,
        PASSWORD_VERIFICATION_CAPACITY,
        CREDENTIAL_ISSUE_LIMIT,
        ADMINISTRATOR_CONTINUITY,
        RECENT_AUTHENTICATION,
        REAUTHENTICATION_FAILED,
        REQUEST_VALIDATION
    }

    public enum ControlTrigger {
        LOGIN_ADDRESS_LIMIT,
        PASSWORD_VERIFICATION_ACCOUNT_LIMIT,
        PASSWORD_VERIFICATION_ADDRESS_LIMIT,
        DISTRIBUTED_LOGIN_THRESHOLD
    }
}

enum SecurityEvent {
    AUTHENTICATION_SUCCEEDED("courtside.authentication.succeeded", Level.INFO, "success",
            Set.of("event.code", "event.outcome", "account.id"), Map.of()),
    AUTHENTICATION_FAILED("courtside.authentication.failed", Level.WARN, "failure",
            Set.of("event.code", "event.outcome", "event.reason", "account.id"),
            Map.of("event.reason", names(SecurityEventLog.AuthenticationFailure.values()))),
    AUTHORIZATION_DENIED("courtside.authorization.denied", Level.WARN, "failure",
            Set.of("event.code", "event.outcome", "account.id"), Map.of()),
    SESSION_TERMINATED("courtside.session.terminated", Level.INFO, "success",
            Set.of("event.code", "event.outcome", "event.reason", "account.id", "actor.account.id"),
            Map.of("event.reason", names(SecurityEventLog.SessionTermination.values()))),
    CREDENTIAL_CHANGED("courtside.credential.changed", Level.INFO, "success",
            Set.of("event.code", "event.outcome", "event.action", "account.id", "actor.account.id"),
            Map.of("event.action", names(SecurityEventLog.CredentialChange.values()))),
    ADMINISTRATIVE_SECURITY_ACTION("courtside.administration.security-action", Level.INFO, "success",
            Set.of("event.code", "event.outcome", "event.action", "account.id", "actor.account.id"),
            Map.of("event.action", names(SecurityEventLog.AdministrativeAction.values()))),
    CONTROL_TRIGGERED("courtside.control.triggered", Level.WARN, "success",
            Set.of("event.code", "event.outcome", "event.reason", "account.id"),
            Map.of("event.reason", names(SecurityEventLog.ControlTrigger.values()))),
    CONTROL_REFUSED("courtside.control.refused", Level.WARN, "failure",
            Set.of("event.code", "event.outcome", "event.reason", "account.id"),
            Map.of("event.reason", names(SecurityEventLog.ControlRefusal.values())));

    private final String code;
    private final Level level;
    private final String outcome;
    private final Set<String> allowedFields;
    private final Map<String, List<String>> allowedValues;

    SecurityEvent(String code, Level level, String outcome, Set<String> allowedFields,
                  Map<String, List<String>> allowedValues) {
        this.code = code;
        this.level = level;
        this.outcome = outcome;
        this.allowedFields = allowedFields;
        this.allowedValues = allowedValues;
    }

    String code() {
        return code;
    }

    Level level() {
        return level;
    }

    String outcome() {
        return outcome;
    }

    Set<String> allowedFields() {
        return allowedFields;
    }

    Map<String, List<String>> allowedValues() {
        return allowedValues;
    }

    static List<SecurityEvent> definitions() {
        return Arrays.asList(values());
    }

    private static List<String> names(Enum<?>[] values) {
        return Arrays.stream(values).map(Enum::name).toList();
    }
}
