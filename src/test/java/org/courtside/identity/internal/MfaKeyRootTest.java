package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class MfaKeyRootTest {

    @Test
    void givenAnOperatorKeyRoot_whenResolving_thenItWinsOverTheImageDirectory(@TempDir Path image) {
        // when
        Path root = MfaConfiguration.keyRoot("/srv/keys", image);
        // then
        assertThat(root).isEqualTo(Path.of("/srv/keys"));
    }

    @Test
    void givenNoKeyRootAndTheImageDirectory_whenResolving_thenTheImageDirectoryHoldsTheKeys(@TempDir Path image) {
        // when
        Path root = MfaConfiguration.keyRoot("", image);
        // then
        assertThat(root).as("the image's own writable directory, not one below its root-owned working directory")
                .isEqualTo(image);
    }

    @Test
    void givenNoKeyRootOutsideTheImage_whenResolving_thenTheWorkingDirectoryHoldsTheKeys(@TempDir Path parent) {
        // when
        Path root = MfaConfiguration.keyRoot(" ", parent.resolve("absent"));
        // then
        assertThat(root).isEqualTo(Path.of(".courtside/keys"));
    }

    @Test
    void whenTheImageIsBuilt_thenItCreatesTheDirectoryTheApplicationPrefers() throws Exception {
        // when
        String dockerfile = Files.readString(Path.of("Dockerfile"));
        // then
        assertThat(dockerfile).as("the image owns and declares the preferred key directory")
                .contains("-o 10001 -g 10001 " + MfaConfiguration.IMAGE_KEY_ROOT)
                .contains("VOLUME " + MfaConfiguration.IMAGE_KEY_ROOT)
                .doesNotContain("ENV COURTSIDE_MFA_KEY_ROOT");
    }
}
