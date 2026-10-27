package org.courtside.identity.internal;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.List;
import java.util.UUID;
import java.util.function.Function;

final class MfaSecrets {
    private static final byte[] CHECK = "courtside-mfa-key-check-v1".getBytes(StandardCharsets.US_ASCII);
    private final JdbcClient jdbc;
    private final TransactionTemplate transaction;
    private final Path root;
    private final Path suppliedFile;

    MfaSecrets(JdbcClient jdbc, PlatformTransactionManager transactions, Path root, Path suppliedFile) {
        if (jdbc == null || transactions == null || root == null) {
            throw new IllegalStateException("MFA key storage configuration is required");
        }
        this.jdbc = jdbc;
        this.transaction = new TransactionTemplate(transactions);
        this.root = root;
        this.suppliedFile = suppliedFile;
    }

    void initialize() {
        withKey(keys -> {
            for (EncryptedSecret secret : encryptedSecrets()) keys.decrypt(secret.account(), secret.value());
            return true;
        });
    }

    String encrypt(UUID account, byte[] secret) {
        return withKey(keys -> keys.encrypt(account, secret));
    }

    byte[] decrypt(UUID account, String encrypted) {
        return withKey(keys -> keys.decrypt(account, encrypted));
    }

    void rotate() {
        withKey(keys -> {
            keys.rotate();
            return true;
        });
    }

    private <T> T withKey(Function<MfaKeyRing, T> operation) {
        return transaction.execute(ignored -> {
            jdbc.sql("""
                    INSERT INTO mfa_instance_key (id, installation_id) VALUES (1, :installation)
                    ON CONFLICT (id) DO NOTHING
                    """).param("installation", UUID.randomUUID()).update();
            Installation installation = jdbc.sql("""
                    SELECT installation_id, key_check FROM mfa_instance_key WHERE id = 1 FOR UPDATE
                    """).query((rs, row) -> new Installation(rs.getObject(1, UUID.class), rs.getString(2))).single();
            boolean required = jdbc.sql("""
                    SELECT EXISTS (SELECT 1 FROM account_mfa
                        WHERE totp_secret IS NOT NULL OR pending_totp_secret IS NOT NULL)
                    """).query(Boolean.class).single();
            Path location = suppliedFile == null
                    ? root.resolve(installation.id().toString()).resolve("mfa.keys") : suppliedFile;
            MfaKeyRing keys = MfaKeyRing.open(location, required);
            boolean matches = false;
            if (installation.check() != null) {
                try {
                    matches = MessageDigest.isEqual(CHECK, keys.decrypt(installation.id(), installation.check()));
                } catch (IllegalStateException failure) {
                    if (required) throw failure;
                }
            }
            if (!matches) {
                if (required) throw new IllegalStateException("MFA instance key does not match the encrypted database");
                jdbc.sql("UPDATE mfa_instance_key SET key_check = :check WHERE id = 1")
                        .param("check", keys.encrypt(installation.id(), CHECK)).update();
            }
            return operation.apply(keys);
        });
    }

    private List<EncryptedSecret> encryptedSecrets() {
        return jdbc.sql("""
                SELECT account_id, totp_secret FROM account_mfa WHERE totp_secret IS NOT NULL
                UNION ALL
                SELECT account_id, pending_totp_secret FROM account_mfa WHERE pending_totp_secret IS NOT NULL
                """).query((rs, row) -> new EncryptedSecret(rs.getObject(1, UUID.class), rs.getString(2))).list();
    }

    private record Installation(UUID id, String check) { }
    private record EncryptedSecret(UUID account, String value) { }
}
