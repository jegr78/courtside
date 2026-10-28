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

    @Test
    void givenAnInitializedInstallation_whenItsKeyFileDisappears_thenVerificationFailsWithoutReplacingIt() throws Exception {
        // given
        MfaSecrets secrets = store(root);
        secrets.initialize();
        secrets.verify();
        Path keyFile;
        try (var files = Files.walk(root)) {
            keyFile = files.filter(path -> path.getFileName().toString().equals("mfa.keys")).findFirst().orElseThrow();
        }
        Files.delete(keyFile);
        // when / then
        assertThatThrownBy(secrets::verify).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("key file is missing");
        assertThat(keyFile).as("verification must never generate replacement key material").doesNotExist();
    }

    @Test
    void givenADatabaseWithoutAnInstallationOrEncryptedFactors_whenVerifying_thenNothingNeedsAKey() {
        // given
        jdbc.sql("DELETE FROM mfa_instance_key").update();
        jdbc.sql("UPDATE account_mfa SET totp_secret = NULL, pending_totp_secret = NULL").update();
        // when / then
        store(root.resolve("never-initialized")).verify();
        assertThat(root.resolve("never-initialized")).as("verification creates no key material").doesNotExist();
    }

    @Test
    void givenEncryptedEnrollmentsWithoutAnInstallation_whenVerifying_thenTheMissingIdentityIsReported() {
        // given
        MfaSecrets secrets = store(root);
        secrets.initialize();
        UUID account = account();
        jdbc.sql("INSERT INTO account_mfa (account_id, totp_secret) VALUES (:id, :secret)")
                .param("id", account).param("secret", secrets.encrypt(account, TotpCodes.newSecret())).update();
        jdbc.sql("DELETE FROM mfa_instance_key").update();
        // when / then
        assertThatThrownBy(secrets::verify).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("identity is missing");
    }

    @Test
    void givenAnInitializedInstallation_whenAnUnrelatedKeyReplacesItsFile_thenVerificationFails() throws Exception {
        // given
        Path supplied = root.resolve("supplied/mfa.keys");
        MfaSecrets secrets = new MfaSecrets(jdbc, transactions, root, supplied);
        secrets.initialize();
        Path unrelated = root.resolve("unrelated/mfa.keys");
        MfaKeyRing.open(unrelated, false);
        Files.move(unrelated, supplied, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        // when / then
        assertThatThrownBy(secrets::verify).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("MFA");
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
