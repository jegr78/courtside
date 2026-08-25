package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;

@Service
@RequiredArgsConstructor
class LoginAttemptProtection {

    private final JdbcClient jdbc;
    private final LoginProtectionProperties properties;
    private final Clock clock;

    @Transactional
    Optional<LoginBlock> registerAttempt(String address) {
        String normalizedAddress = normalizeAddress(address);
        lock(Scope.ADDRESS, hash(normalizedAddress));
        lock(Scope.GLOBAL, hash("all"));

        Optional<LoginBlock> retryAfter = retryAfter(normalizedAddress);
        if (retryAfter.isPresent()) {
            return retryAfter;
        }

        recordAttempt(Scope.ADDRESS, normalizedAddress, properties.address());
        recordAttempt(Scope.GLOBAL, "all", properties.global());
        return Optional.empty();
    }

    private Optional<LoginBlock> retryAfter(String address) {
        Instant now = clock.instant();
        return java.util.stream.Stream.of(
                        blockedUntil(Scope.ADDRESS, address).map(until -> Map.entry(Scope.ADDRESS, until)),
                        blockedUntil(Scope.GLOBAL, "all").map(until -> Map.entry(Scope.GLOBAL, until)))
                .flatMap(Optional::stream)
                .filter(blocked -> blocked.getValue().isAfter(now))
                .max(Map.Entry.comparingByValue())
                .map(blocked -> new LoginBlock(blocked.getKey().name(),
                        Duration.between(now, blocked.getValue())));
    }

    @Transactional
    void clear(String address) {
        jdbc.sql("DELETE FROM login_attempt_limit WHERE scope = 'ADDRESS' AND subject_hash = :address")
                .param("address", hash(normalizeAddress(address)))
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

    private void recordAttempt(Scope scope, String subject, LoginProtectionProperties.Limit limit) {
        String subjectHash = hash(subject);
        Instant now = clock.instant();
        Attempt current = jdbc.sql("""
                        SELECT attempt_count, window_started_at, blocked_until
                        FROM login_attempt_limit
                        WHERE scope = :scope AND subject_hash = :subjectHash
                        """)
                .param("scope", scope.name())
                .param("subjectHash", subjectHash)
                .query((rs, row) -> new Attempt(
                        rs.getInt("attempt_count"),
                        rs.getObject("window_started_at", OffsetDateTime.class).toInstant(),
                        toInstant(rs.getObject("blocked_until", OffsetDateTime.class))))
                .optional()
                .orElse(null);

        boolean windowExpired = current == null
                || !current.windowStartedAt().plus(limit.window()).isAfter(now);
        int attempts = windowExpired ? 1 : current.attemptCount() + 1;
        Instant windowStartedAt = windowExpired ? now : current.windowStartedAt();
        Instant blockedUntil = attempts >= limit.maxFailures() ? now.plus(limit.block()) : null;

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
        ADDRESS,
        GLOBAL
    }

    private record Attempt(int attemptCount, Instant windowStartedAt, Instant blockedUntil) {
    }
}
