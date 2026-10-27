package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MaintenanceEmailTest {
    @TempDir Path temporary;

    @Test
    void givenAPrivateAddressFile_whenRead_thenOnlyOneOptionalTrailingLineFeedIsRemoved() throws Exception {
        // given
        Path file = privateFile("jane.doe@example.org\n");
        // when / then
        assertThat(MaintenanceEmail.read(file)).isEqualTo("jane.doe@example.org");
        Files.writeString(file, "john.roe@example.org", StandardCharsets.UTF_8);
        assertThat(MaintenanceEmail.read(file)).isEqualTo("john.roe@example.org");
    }

    @Test
    void givenPublicOrLinkedFiles_whenRead_thenTheyAreRefusedWithoutContent() throws Exception {
        // given
        Path file = privateFile("jane.doe@example.org");
        Path link = temporary.resolve("link");
        Files.createSymbolicLink(link, file);
        // when / then
        assertRefused(link);
        assertRefused(temporary);
        Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-r--r--"));
        assertRefused(file);
    }

    @Test
    void givenOversizeOrMalformedContent_whenRead_thenItIsRefusedWithoutContent() throws Exception {
        // given
        Path file = privateFile("jane.doe@example.org");
        // when / then
        for (String value : new String[]{"x".repeat(255), "jane.doe@example.org\n\n", "jane.doe@example.org\r\n", "jane\u0000.doe@example.org", "jane\tdoe@example.org", "jane\u0085doe@example.org"}) {
            Files.writeString(file, value, StandardCharsets.UTF_8);
            assertRefused(file);
        }
        Files.write(file, new byte[]{(byte) 0xc3, (byte) 0x28});
        assertRefused(file);
    }

    @Test
    void givenAnAddressOfExactly254BytesWithAFinalLineFeed_whenRead_thenItsAddressIsAccepted() throws Exception {
        // given
        String email = "x".repeat(64) + "@" + "x".repeat(63) + "." + "x".repeat(63) + "." + "x".repeat(61);
        assertThat(email.getBytes(StandardCharsets.UTF_8)).hasSize(254);
        Path file = privateFile(email + "\n");
        // when / then
        assertThat(MaintenanceEmail.read(file)).isEqualTo(email);
    }

    @Test
    void givenAForeignWritableParent_whenThePrivateFileIsRead_thenTheDirectoryCannotSwapItsContent() throws Exception {
        // given
        Path file = privateFile("jane.doe@example.org");
        Files.setPosixFilePermissions(file.getParent(), PosixFilePermissions.fromString("rwxrwxrwx"));
        // when / then
        try {
            assertRefused(file);
        } finally {
            Files.setPosixFilePermissions(file.getParent(), PosixFilePermissions.fromString("rwx------"));
        }
    }

    @Test
    void givenForeignOwnershipOrWritableAncestors_whenTrustIsEvaluated_thenOnlyRootStickyWithAPrivateOwnedChildIsAllowed() {
        // given / when / then
        assertThat(MaintenanceEmail.trustedDirectory(502, 0700, 501, 501, 0700)).isFalse();
        assertThat(MaintenanceEmail.trustedDirectory(501, 0770, 501, 501, 0700)).isFalse();
        assertThat(MaintenanceEmail.trustedDirectory(0, 01777, 501, 502, 0700)).isFalse();
        assertThat(MaintenanceEmail.trustedDirectory(0, 01777, 501, 501, 0755)).isFalse();
        assertThat(MaintenanceEmail.trustedDirectory(0, 01777, 501, 501, 0700)).isTrue();
        assertThat(MaintenanceEmail.trustedDirectory(501, 0700, 501, -1, 0)).isTrue();
    }

    @Test
    void givenASymlinkInTheSuppliedParentPath_whenRead_thenTheLexicalPathIsRefused() throws Exception {
        // given
        Path file = privateFile("jane.doe@example.org");
        Path child = Files.createDirectory(temporary.toRealPath().resolve("child"));
        Path alias = temporary.toRealPath().resolve("alias");
        Files.createSymbolicLink(alias, child);
        // when / then
        assertRefused(alias.resolve("..").resolve(file.getFileName()));
        assertRefused(alias.resolve(file.getFileName()));
        assertRefused(file.getFileName());
    }

    @Test
    void givenAHardLinkedAddressFile_whenRead_thenThePrivateModeDoesNotMakeItAcceptable() throws Exception {
        // given
        Path file = privateFile("jane.doe@example.org");
        Files.createLink(temporary.toRealPath().resolve("duplicate"), file);
        // when / then
        assertRefused(file);
    }

    private Path privateFile(String value) throws Exception {
        Path file = temporary.toRealPath().resolve("email");
        Files.writeString(file, value, StandardCharsets.UTF_8);
        Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"));
        return file;
    }

    private void assertRefused(Path file) {
        assertThatThrownBy(() -> MaintenanceEmail.read(file)).isInstanceOf(IllegalStateException.class)
                .hasMessage("Maintenance email requires a private owned regular UTF-8 file in trusted directories");
    }
}
