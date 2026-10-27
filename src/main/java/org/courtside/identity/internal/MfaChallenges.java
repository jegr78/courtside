package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

@Repository
@RequiredArgsConstructor
class MfaChallenges {
    private final JdbcClient jdbc;
    private final Clock clock;

    enum Purpose { LOGIN, REAUTHENTICATION, WEBAUTHN_REGISTRATION }

    @Transactional
    Optional<UUID> issue(UUID account, long epoch, Purpose purpose, String session, String payload) {
        requireBindings(account, purpose, session);
        if (payload == null || payload.length() > 65_536) {
            throw new IllegalStateException("Invalid MFA challenge options");
        }
        if (!lockCurrentAccount(account, epoch)) return Optional.empty();
        String sessionHash = sessionHash(session);
        jdbc.sql("""
                DELETE FROM mfa_challenge WHERE account_id = :account
                    AND ((session_hash = :session AND purpose = :purpose) OR expires_at <= :now)
                """).param("account", account).param("session", sessionHash).param("purpose", purpose.name())
                .param("now", clock.instant().atOffset(ZoneOffset.UTC)).update();
        UUID id = UUID.randomUUID();
        jdbc.sql("""
                INSERT INTO mfa_challenge (id, account_id, security_epoch, purpose, session_hash, expires_at, payload)
                VALUES (:id, :account, :epoch, :purpose, :session, :expires, :payload)
                """).param("id", id).param("account", account).param("epoch", epoch)
                .param("purpose", purpose.name()).param("session", sessionHash)
                .param("expires", clock.instant().plusSeconds(300).atOffset(ZoneOffset.UTC))
                .param("payload", payload).update();
        return Optional.of(id);
    }

    @Transactional
    Optional<Challenge> attempt(UUID id, UUID account, long epoch, Purpose purpose, String session) {
        requireBindings(account, purpose, session);
        if (id == null || !lockCurrentAccount(account, epoch)) return Optional.empty();
        return jdbc.sql("""
                UPDATE mfa_challenge SET attempt_count = attempt_count + 1
                WHERE id = :id AND account_id = :account AND security_epoch = :epoch
                    AND purpose = :purpose AND session_hash = :session AND expires_at > :now AND attempt_count < 5
                RETURNING id, payload
                """).param("id", id).param("account", account).param("epoch", epoch)
                .param("purpose", purpose.name()).param("session", sessionHash(session))
                .param("now", clock.instant().atOffset(ZoneOffset.UTC))
                .query((rs, row) -> new Challenge(rs.getObject(1, UUID.class), rs.getString(2))).optional();
    }

    @Transactional
    boolean consume(UUID id) {
        return id != null && jdbc.sql("DELETE FROM mfa_challenge WHERE id = :id")
                .param("id", id).update() == 1;
    }

    private boolean lockCurrentAccount(UUID account, long epoch) {
        Optional<Boolean> current = jdbc.sql("""
                SELECT enabled AND security_epoch = :epoch FROM user_account WHERE id = :id FOR UPDATE
                """).param("id", account).param("epoch", epoch).query(Boolean.class).optional();
        return current.orElse(false) && !jdbc.sql("""
                SELECT EXISTS (SELECT 1 FROM account_mfa WHERE account_id = :id AND recovery_pending)
                """).param("id", account).query(Boolean.class).single();
    }

    private static void requireBindings(UUID account, Purpose purpose, String session) {
        if (account == null || purpose == null || session == null || session.isBlank()) {
            throw new IllegalStateException("MFA challenge bindings are required");
        }
    }

    private static String sessionHash(String session) {
        return ResetCodes.fingerprint("MFA-SESSION:" + session);
    }

    record Challenge(UUID id, String payload) { }
}
