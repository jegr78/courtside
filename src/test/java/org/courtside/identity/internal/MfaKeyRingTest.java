package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;

class MfaKeyRingTest {
    @TempDir
    Path temporary;

    private static final UUID ACCOUNT = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final byte[] SECRET = "example-totp-secret".getBytes(StandardCharsets.US_ASCII);

    @Test
    void givenANewInstance_whenReopeningItsKeyFile_thenEncryptedSecretsStillDecrypt() throws Exception {
        // given
        Path file = temporary.resolve("keys/mfa.keys");
        MfaKeyRing original = MfaKeyRing.open(file, false);
        String encrypted = original.encrypt(ACCOUNT, SECRET);
        // when
        MfaKeyRing reopened = MfaKeyRing.open(file, true);
        // then
        assertThat(reopened.decrypt(ACCOUNT, encrypted)).isEqualTo(SECRET);
        assertThat(reopened.activeKeyId()).isEqualTo(original.activeKeyId());
        assertThat(Files.readString(file)).doesNotContain("example-totp-secret");
        assertThat(Files.getPosixFilePermissions(file)).containsExactlyInAnyOrder(
                PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE);
    }

    @Test
    void givenTheSameSecret_whenEncryptingTwice_thenFreshNoncesProduceDifferentCiphertext() {
        // given
        MfaKeyRing keys = MfaKeyRing.open(temporary.resolve("mfa.keys"), false);
        // when
        String first = keys.encrypt(ACCOUNT, SECRET);
        String second = keys.encrypt(ACCOUNT, SECRET);
        // then
        assertThat(first).isNotEqualTo(second).doesNotContain("example-totp-secret");
        assertThat(keys.decrypt(ACCOUNT, first)).isEqualTo(SECRET);
        assertThat(keys.decrypt(ACCOUNT, second)).isEqualTo(SECRET);
    }

    @Test
    void givenEncryptedAccountData_whenAnotherAccountTriesToUseIt_thenAuthenticationFails() {
        // given
        MfaKeyRing keys = MfaKeyRing.open(temporary.resolve("mfa.keys"), false);
        String encrypted = keys.encrypt(ACCOUNT, SECRET);
        // when / then
        assertThatThrownBy(() -> keys.decrypt(UUID.randomUUID(), encrypted))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("MFA").hasMessageNotContaining("example-totp-secret");
    }

    @Test
    void givenEncryptedData_whenTheRequiredKeyFileIsMissing_thenNoReplacementIsGenerated() {
        // given
        Path file = temporary.resolve("mfa.keys");
        // when / then
        assertThatThrownBy(() -> MfaKeyRing.open(file, true))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("MFA");
        assertThat(file).doesNotExist();
    }

    @Test
    void givenIndependentInstances_whenOneTriesTheOthersCiphertext_thenItsKeyCannotDecryptIt() {
        // given
        MfaKeyRing first = MfaKeyRing.open(temporary.resolve("first/mfa.keys"), false);
        MfaKeyRing second = MfaKeyRing.open(temporary.resolve("second/mfa.keys"), false);
        String encrypted = first.encrypt(ACCOUNT, SECRET);
        // when / then
        assertThat(second.activeKeyId()).isNotEqualTo(first.activeKeyId());
        assertThatThrownBy(() -> second.decrypt(ACCOUNT, encrypted))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("MFA");
    }

    @Test
    void givenAKeyRing_whenRotatingAndRestarting_thenOldAndNewCiphertextRemainReadable() {
        // given
        Path file = temporary.resolve("mfa.keys");
        MfaKeyRing keys = MfaKeyRing.open(file, false);
        String originalId = keys.activeKeyId();
        String oldSecret = keys.encrypt(ACCOUNT, SECRET);
        // when
        keys.rotate();
        String newSecret = keys.encrypt(ACCOUNT, SECRET);
        MfaKeyRing restarted = MfaKeyRing.open(file, true);
        // then
        assertThat(restarted.activeKeyId()).isNotEqualTo(originalId);
        assertThat(newSecret).startsWith(restarted.activeKeyId() + ".");
        assertThat(restarted.decrypt(ACCOUNT, oldSecret)).isEqualTo(SECRET);
        assertThat(restarted.decrypt(ACCOUNT, newSecret)).isEqualTo(SECRET);
    }

    @Test
    void givenAnExistingCorruptKeyFile_whenStarting_thenItsContentsArePreserved() throws Exception {
        // given
        Path file = temporary.resolve("mfa.keys");
        Files.writeString(file, "invalid-key-file");
        // when / then
        assertThatThrownBy(() -> MfaKeyRing.open(file, false))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("MFA");
        assertThat(Files.readString(file)).isEqualTo("invalid-key-file");
    }

    @Test
    void givenAValidEnvelope_whenCiphertextOrNonceIsAltered_thenDecryptionFails() {
        // given
        MfaKeyRing keys = MfaKeyRing.open(temporary.resolve("mfa.keys"), false);
        String[] pieces = keys.encrypt(ACCOUNT, SECRET).split("\\.");
        assertThat(pieces).hasSize(3);
        byte[] cipher = Base64.getUrlDecoder().decode(pieces[2]);
        cipher[0] ^= 1;
        String altered = pieces[0] + "." + pieces[1] + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(cipher);
        // when / then
        assertThatThrownBy(() -> keys.decrypt(ACCOUNT, altered)).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> keys.decrypt(ACCOUNT, "malformed"))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void givenConcurrentInitializers_whenOpeningOneInstance_thenEveryCallerUsesTheSameKey() throws Exception {
        // given
        Path file = temporary.resolve("mfa.keys");
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(4)) {
            var work = List.of(1, 2, 3, 4).stream().map(ignored -> executor.submit(() -> {
                start.await();
                return MfaKeyRing.open(file, false);
            })).toList();
            // when
            start.countDown();
            MfaKeyRing first = work.getFirst().get();
            String encrypted = first.encrypt(ACCOUNT, SECRET);
            // then
            for (var task : work) {
                assertThat(task.get().activeKeyId()).isEqualTo(first.activeKeyId());
                assertThat(task.get().decrypt(ACCOUNT, encrypted)).isEqualTo(SECRET);
            }
        }
    }
    @Test
    void givenMalformedPrivateKeyMetadata_whenOpeningFails_thenTheExceptionDoesNotDiscloseItsValue() throws Exception {
        // given
        Path file = temporary.resolve("mfa.keys");
        MfaKeyRing.open(file, false);
        Files.writeString(file, "format=1\nactive=example-private-key-material\n");
        // when
        Throwable failure = catchThrowable(() -> MfaKeyRing.open(file, true));
        // then
        assertThat(failure).isInstanceOf(IllegalStateException.class);
        StringWriter trace = new StringWriter();
        failure.printStackTrace(new PrintWriter(trace));
        assertThat(trace.toString()).doesNotContain("example-private-key-material");
    }

    @Test
    void givenMalformedKeyFileEscapes_whenOpening_thenAnOperationalFailureKeepsTheFileIntact() throws Exception {
        // given
        Path file = temporary.resolve("mfa.keys");
        MfaKeyRing.open(file, false);
        String malformed = "format=1\nactive=" + "\\" + "uZZZZ\n";
        Files.writeString(file, malformed);
        // when / then
        assertThatThrownBy(() -> MfaKeyRing.open(file, true))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("MFA");
        assertThat(Files.readString(file)).isEqualTo(malformed);
    }

}
