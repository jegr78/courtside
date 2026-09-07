package org.courtside.identity.internal;

import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.courtside.shared.SecurityEventLog;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.Optional;

@Service
@RequiredArgsConstructor
class LoginAttemptProtection {

    private final JdbcClient jdbc;
    private final LoginProtectionProperties properties;
    private final Clock clock;
    private final MeterRegistry meters;
    private final SecurityEventLog securityEvents;

    @Transactional
    Optional<LoginBlock> registerAttempt(String address) {
        return registerAttempt(address, true, SecurityEventLog.ControlTrigger.LOGIN_ADDRESS_LIMIT);
    }

    @Transactional
    Optional<LoginBlock> registerAttempt(String address, boolean observeGlobal,
                                         SecurityEventLog.ControlTrigger addressLimitReason) {
        String normalizedAddress = normalizeAddress(address);
        lock(Scope.ADDRESS, hash(normalizedAddress));

        Optional<LoginBlock> retryAfter = retryAfter(normalizedAddress);
        if (retryAfter.isPresent()) {
            return retryAfter;
        }

        recordAttempt(Scope.ADDRESS, normalizedAddress, properties.address(), addressLimitReason);
        if (observeGlobal) {
            lock(Scope.GLOBAL, hash("all"));
            observeGlobalAttempt();
        }
        return Optional.empty();
    }

    @Transactional
    Optional<LoginBlock> registerCredentialAttempt(String accountId, String address) {
        String account = "credential-account:" + accountId;
        String source = "credential-address:" + normalizeAddress(address);
        // Every caller acquires the account lock first, so shared addresses cannot create a lock cycle.
        lock(Scope.ACCOUNT, hash(account));
        lock(Scope.ADDRESS, hash(source));

        Optional<LoginBlock> retryAfter = retryAfter(Scope.ACCOUNT, account)
                .or(() -> retryAfter(Scope.ADDRESS, source));
        if (retryAfter.isPresent()) {
            return retryAfter;
        }

        recordAttempt(Scope.ACCOUNT, account, properties.address(),
                SecurityEventLog.ControlTrigger.PASSWORD_VERIFICATION_ACCOUNT_LIMIT);
        recordAttempt(Scope.ADDRESS, source, properties.address(),
                SecurityEventLog.ControlTrigger.PASSWORD_VERIFICATION_ADDRESS_LIMIT);
        return Optional.empty();
    }

    private Optional<LoginBlock> retryAfter(String address) {
        Instant now = clock.instant();
        return retryAfter(Scope.ADDRESS, address);
    }

    private Optional<LoginBlock> retryAfter(Scope scope, String subject) {
        Instant now = clock.instant();
        return blockedUntil(scope, subject)
                .filter(until -> until.isAfter(now))
                .map(until -> new LoginBlock(scope.name(), Duration.between(now, until)));
    }

    @Transactional
    void clear(String address) {
        clear(Scope.ADDRESS, normalizeAddress(address));
    }

    @Transactional
    void clearCredentialAccountAttempt(String accountId) {
        String account = "credential-account:" + accountId;
        clear(Scope.ACCOUNT, account);
    }

    private void clear(Scope scope, String subject) {
        jdbc.sql("DELETE FROM login_attempt_limit WHERE scope = :scope AND subject_hash = :subject")
                .param("scope", scope.name())
                .param("subject", hash(subject))
                .update();
    }

    private Optional<Instant> blockedUntil(Scope scope, String subject) {
        String subjectHash = hash(subject);
        return jdbc.sql("""
                        SELECT blocked_until
                        FROM login_attempt_limit
                        WHERE scope = :scope AND subject_hash = :subjectHash
                        """)
                .param("scope", scope.name())
                .param("subjectHash", subjectHash)
                .query(OffsetDateTime.class)
                .optional()
                .map(OffsetDateTime::toInstant);
    }

    private void lock(Scope scope, String subjectHash) {
        String lockKey = scope.name() + ':' + subjectHash;
        jdbc.sql("SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))) lock")
                .param("key", lockKey)
                .query(Long.class)
                .single();
    }

    private void recordAttempt(Scope scope, String subject, LoginProtectionProperties.Limit limit,
                               SecurityEventLog.ControlTrigger addressLimitReason) {
        String subjectHash = hash(subject);
        Instant now = clock.instant();
        Attempt current = currentAttempt(scope, subject).orElse(null);

        boolean windowExpired = current == null
                || !current.windowStartedAt().plus(limit.window()).isAfter(now);
        int attempts = windowExpired ? 1 : current.attemptCount() + 1;
        Instant windowStartedAt = windowExpired ? now : current.windowStartedAt();
        Instant blockedUntil = attempts >= limit.maxFailures() ? now.plus(limit.block()) : null;
        if (blockedUntil != null && (current == null || current.blockedUntil() == null
                || !current.blockedUntil().isAfter(now))) {
            securityEvents.controlTriggered(null, addressLimitReason);
        }

        jdbc.sql("""
                        INSERT INTO login_attempt_limit
                            (scope, subject_hash, attempt_count, window_started_at, blocked_until)
                        VALUES (:scope, :subjectHash, :attempts, :windowStartedAt, :blockedUntil)
                        ON CONFLICT (scope, subject_hash) DO UPDATE
                        SET attempt_count = EXCLUDED.attempt_count,
                            window_started_at = EXCLUDED.window_started_at,
                            blocked_until = EXCLUDED.blocked_until
                        """)
                .param("scope", scope.name())
                .param("subjectHash", subjectHash)
                .param("attempts", attempts)
                .param("windowStartedAt", windowStartedAt.atOffset(ZoneOffset.UTC))
                .param("blockedUntil", blockedUntil == null
                        ? null : blockedUntil.atOffset(ZoneOffset.UTC))
                .update();
    }

    private void observeGlobalAttempt() {
        LoginProtectionProperties.Observation observation = properties.global();
        Instant now = clock.instant();
        Attempt current = currentAttempt(Scope.GLOBAL, "all").orElse(null);
        boolean windowExpired = current == null
                || !current.windowStartedAt().plus(observation.window()).isAfter(now);
        int attempts = windowExpired ? 1 : current.attemptCount() + 1;
        Instant windowStartedAt = windowExpired ? now : current.windowStartedAt();

        if (attempts == observation.threshold()) {
            meters.counter("courtside.login.distributed.thresholds").increment();
            securityEvents.controlTriggered(null,
                    SecurityEventLog.ControlTrigger.DISTRIBUTED_LOGIN_THRESHOLD);
        }

        jdbc.sql("""
                        INSERT INTO login_attempt_limit
                            (scope, subject_hash, attempt_count, window_started_at, blocked_until)
                        VALUES ('GLOBAL', :subjectHash, :attempts, :windowStartedAt, NULL)
                        ON CONFLICT (scope, subject_hash) DO UPDATE
                        SET attempt_count = EXCLUDED.attempt_count,
                            window_started_at = EXCLUDED.window_started_at,
                            blocked_until = NULL
                        """)
                .param("subjectHash", hash("all"))
                .param("attempts", attempts)
                .param("windowStartedAt", windowStartedAt.atOffset(ZoneOffset.UTC))
                .update();
    }

    private Optional<Attempt> currentAttempt(Scope scope, String subject) {
        return jdbc.sql("""
                        SELECT attempt_count, window_started_at, blocked_until
                        FROM login_attempt_limit
                        WHERE scope = :scope AND subject_hash = :subjectHash
                        """)
                .param("scope", scope.name())
                .param("subjectHash", hash(subject))
                .query((rs, row) -> new Attempt(
                        rs.getInt("attempt_count"),
                        rs.getObject("window_started_at", OffsetDateTime.class).toInstant(),
                        toInstant(rs.getObject("blocked_until", OffsetDateTime.class))))
                .optional();
    }

    private Instant toInstant(OffsetDateTime value) {
        return value == null ? null : value.toInstant();
    }

    private String normalizeAddress(String address) {
        return address == null || address.isBlank() ? "unknown" : address.strip();
    }

    private String hash(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private enum Scope {
        ACCOUNT,
        ADDRESS,
        GLOBAL
    }

    private record Attempt(int attemptCount, Instant windowStartedAt, Instant blockedUntil) {
    }
}
