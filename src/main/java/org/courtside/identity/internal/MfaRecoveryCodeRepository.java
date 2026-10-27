package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

@Repository
@RequiredArgsConstructor
class MfaRecoveryCodeRepository {
    private final JdbcClient jdbc;
    private final Clock clock;

    @Transactional
    void replace(UUID account, List<String> plaintext) {
        requireAccount(account);
        if (plaintext == null || plaintext.isEmpty() || plaintext.size() > 10) {
            throw new IllegalStateException("Invalid MFA recovery code set");
        }
        List<String> hashes = plaintext.stream().map(code -> MfaRecoveryCodes.verifier(code)
                .orElseThrow(() -> new IllegalStateException("Invalid MFA recovery code set"))).toList();
        if (hashes.stream().distinct().count() != hashes.size()) {
            throw new IllegalStateException("Invalid MFA recovery code set");
        }
        if (jdbc.sql("SELECT id FROM user_account WHERE id = :account FOR UPDATE")
                .param("account", account).query(UUID.class).optional().isEmpty()) {
            throw new IllegalStateException("MFA account is missing");
        }
        jdbc.sql("DELETE FROM mfa_recovery_code WHERE account_id = :account")
                .param("account", account).update();
        OffsetDateTime created = clock.instant().atOffset(ZoneOffset.UTC);
        for (String hash : hashes) {
            jdbc.sql("""
                    INSERT INTO mfa_recovery_code (account_id, code_hash, created_at)
                    VALUES (:account, :hash, :created)
                    """).param("account", account).param("hash", hash).param("created", created).update();
        }
    }

    @Transactional(readOnly = true)
    int remaining(UUID account) {
        requireAccount(account);
        return jdbc.sql("SELECT count(*) FROM mfa_recovery_code WHERE account_id = :account")
                .param("account", account).query(Integer.class).single();
    }

    @Transactional
    boolean consume(UUID account, String code) {
        requireAccount(account);
        return MfaRecoveryCodes.verifier(code).map(hash -> jdbc.sql("""
                        DELETE FROM mfa_recovery_code WHERE account_id = :account AND code_hash = :hash
                        """).param("account", account).param("hash", hash).update() == 1).orElse(false);
    }

    private static void requireAccount(UUID account) {
        if (account == null) throw new IllegalStateException("MFA account is required");
    }
}
