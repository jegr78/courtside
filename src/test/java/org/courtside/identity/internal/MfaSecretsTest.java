package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MfaSecretsTest extends AbstractIntegrationTest {
    @Autowired private JdbcClient jdbc;
    @Autowired private PlatformTransactionManager transactions;
    @TempDir private Path root;

    @Test
    void givenAnInstallation_whenReopeningAndRotating_thenItsEncryptedSecretsRemainReadable() {
        // given
        UUID account = UUID.randomUUID();
        byte[] secret = TotpCodes.newSecret();
        MfaSecrets initial = store(root);
        // when
        initial.initialize();
        String encrypted = initial.encrypt(account, secret);
        MfaSecrets reopened = store(root);
        reopened.initialize();
        reopened.rotate();
        // then
        assertThat(reopened.decrypt(account, encrypted)).isEqualTo(secret);
        assertThat(initial.decrypt(account, reopened.encrypt(account, secret))).isEqualTo(secret);
    }

    @Test
    void givenEncryptedEnrollments_whenStartingWithoutTheKey_thenInitializationFailsWithoutReplacement() throws Exception {
        // given
        UUID account = account();
        MfaSecrets original = store(root);
        String encrypted = original.encrypt(account, TotpCodes.newSecret());
        persist(account, encrypted);
        Path missing = root.resolve("missing");
        // when / then
        assertThatThrownBy(() -> store(missing).initialize()).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("key file is missing");
        try (var files = Files.walk(missing)) {
            assertThat(files.filter(path -> path.toString().endsWith("mfa.keys")).toList()).isEmpty();
        }
        assertThat(original.decrypt(account, encrypted)).hasSize(20);
    }

    @Test
    void givenEncryptedEnrollments_whenStartingWithAnUnrelatedKey_thenInitializationFails() {
        // given
        UUID account = account();
        String encrypted = store(root).encrypt(account, TotpCodes.newSecret());
        persist(account, encrypted);
        Path wrong = root.resolve("wrong.keys");
        MfaKeyRing.open(wrong, false);
        // when / then
        assertThatThrownBy(() -> new MfaSecrets(jdbc, transactions, root, wrong).initialize())
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("unavailable instance key");
    }

    @Test
    void givenADatabaseWithoutEncryptedFactors_whenImportingWithoutKeyMaterial_thenInitializationRemainsAutomatic() {
        // given
        MfaSecrets original = store(root);
        original.initialize();
        UUID account = UUID.randomUUID();
        MfaSecrets imported = store(root.resolve("fresh"));
        // when
        imported.initialize();
        String encrypted = imported.encrypt(account, TotpCodes.newSecret());
        // then
        assertThat(imported.decrypt(account, encrypted)).hasSize(20);
        assertThatThrownBy(() -> original.decrypt(account, encrypted)).isInstanceOf(IllegalStateException.class);
    }

    private MfaSecrets store(Path location) {
        return new MfaSecrets(jdbc, transactions, location, null);
    }

    private UUID account() {
        UUID id = UUID.randomUUID();
        jdbc.sql("INSERT INTO person (id, first_name, last_name, email) VALUES (:id, 'Jane', 'Doe', :email)")
                .param("id", id).param("email", id + "@example.org").update();
        jdbc.sql("""
                INSERT INTO user_account (id, person_id, username, locale, enabled, password_change_required)
                VALUES (:id, :id, :username, 'en', true, true)
                """).param("id", id).param("username", "mfa." + id).update();
        return id;
    }

    private void persist(UUID account, String encrypted) {
        jdbc.sql("INSERT INTO account_mfa (account_id, totp_secret) VALUES (:id, :secret)")
                .param("id", account).param("secret", encrypted).update();
    }
}
