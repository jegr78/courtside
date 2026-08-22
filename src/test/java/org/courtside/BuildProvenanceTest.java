package org.courtside;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Properties;
import org.junit.jupiter.api.Test;

class BuildProvenanceTest {

    @Test
    void givenLinkedWorktree_whenBuildMetadataIsGenerated_thenCurrentWorktreeCommitIsRecorded()
            throws IOException, InterruptedException {
        // given
        Process git = new ProcessBuilder("git", "rev-parse", "HEAD").start();
        String expectedCommit = new String(git.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
        Properties buildProvenance = new Properties();
        try (InputStream gitProperties = getClass().getResourceAsStream("/git.properties")) {
            assertThat(gitProperties).isNotNull();
            buildProvenance.load(gitProperties);
        }

        // when
        int exitCode = git.waitFor();

        // then
        assertThat(exitCode).isZero();
        assertThat(buildProvenance.getProperty("git.commit.id")).isEqualTo(expectedCommit);
    }
}
