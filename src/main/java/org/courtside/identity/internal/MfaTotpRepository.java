package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

@Repository
@RequiredArgsConstructor
class MfaTotpRepository {
    private final JdbcClient jdbc;
    private final MfaSecrets secrets;
    private final Clock clock;

    @Transactional
    byte[] begin(UUID account) {
        lock(account);
        byte[] secret = TotpCodes.newSecret();
        jdbc.sql("""
                INSERT INTO account_mfa (account_id, pending_totp_secret, pending_totp_expires_at)
                VALUES (:id, :secret, :expires)
                ON CONFLICT (account_id) DO UPDATE SET
                    pending_totp_secret = EXCLUDED.pending_totp_secret,
                    pending_totp_expires_at = EXCLUDED.pending_totp_expires_at
                """).param("id", account).param("secret", secrets.encrypt(account, secret))
                .param("expires", clock.instant().plusSeconds(300).atOffset(ZoneOffset.UTC)).update();
        return secret;
    }

    @Transactional
    boolean confirm(UUID account, String code) {
        lock(account);
        Optional<State> pending = state(account).filter(value -> value.pending() != null
                && value.expires().isAfter(clock.instant()));
        if (pending.isEmpty()) return false;
        State current = pending.orElseThrow();
        var matched = TotpCodes.match(secrets.decrypt(account, current.pending()), code, clock.instant(), -1);
        if (matched.isEmpty()) return false;
        jdbc.sql("""
                UPDATE account_mfa SET totp_secret = pending_totp_secret, totp_last_step = :step,
                    pending_totp_secret = NULL, pending_totp_expires_at = NULL
                WHERE account_id = :id
                """).param("id", account).param("step", matched.getAsLong()).update();
        return true;
    }

    @Transactional
    boolean verify(UUID account, String code) {
        lock(account);
        Optional<State> active = state(account).filter(value -> value.secret() != null && !value.recoveryPending());
        if (active.isEmpty()) return false;
        State current = active.orElseThrow();
        var matched = TotpCodes.match(secrets.decrypt(account, current.secret()), code,
                clock.instant(), current.lastStep());
        if (matched.isEmpty()) return false;
        jdbc.sql("UPDATE account_mfa SET totp_last_step = :step WHERE account_id = :id")
                .param("id", account).param("step", matched.getAsLong()).update();
        return true;
    }

    @Transactional(readOnly = true)
    boolean enabled(UUID account) {
        requireAccount(account);
        return state(account).map(value -> value.secret() != null).orElse(false);
    }

    @Transactional
    void remove(UUID account) {
        lock(account);
        jdbc.sql("""
                UPDATE account_mfa SET totp_secret = NULL, totp_last_step = -1,
                    pending_totp_secret = NULL, pending_totp_expires_at = NULL WHERE account_id = :id
                """).param("id", account).update();
    }

    private Optional<State> state(UUID account) {
        return jdbc.sql("""
                SELECT totp_secret, totp_last_step, pending_totp_secret, pending_totp_expires_at, recovery_pending
                FROM account_mfa WHERE account_id = :id
                """).param("id", account).query((rs, row) -> {
                    OffsetDateTime expires = rs.getObject(4, OffsetDateTime.class);
                    return new State(rs.getString(1), rs.getLong(2), rs.getString(3),
                            expires == null ? null : expires.toInstant(), rs.getBoolean(5));
                }).optional();
    }

    private void lock(UUID account) {
        requireAccount(account);
        if (jdbc.sql("SELECT id FROM user_account WHERE id = :id FOR UPDATE")
                .param("id", account).query(UUID.class).optional().isEmpty()) {
            throw new IllegalStateException("MFA account is missing");
        }
    }

    private static void requireAccount(UUID account) {
        if (account == null) throw new IllegalStateException("MFA account is required");
    }

    private record State(String secret, long lastStep, String pending, Instant expires, boolean recoveryPending) { }
}
