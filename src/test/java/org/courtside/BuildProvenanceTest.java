package org.courtside;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;
import org.eclipse.jgit.lib.Constants;
import org.eclipse.jgit.lib.Repository;
import org.eclipse.jgit.storage.file.FileRepositoryBuilder;
import org.junit.jupiter.api.Test;

class BuildProvenanceTest {

    @Test
    void givenLinkedWorktree_whenBuildMetadataIsGenerated_thenCurrentWorktreeCommitIsRecorded()
            throws IOException {
        // given
        String expectedCommit;
        try (Repository repository = new FileRepositoryBuilder().findGitDir().build()) {
            expectedCommit = repository.resolve(Constants.HEAD).name();
        }
        Properties buildProvenance = new Properties();
        try (InputStream gitProperties = getClass().getResourceAsStream("/git.properties")) {
            assertThat(gitProperties).isNotNull();
            buildProvenance.load(gitProperties);
        }

        // when
        String recordedCommit = buildProvenance.getProperty("git.commit.id");

        // then
        assertThat(recordedCommit).isEqualTo(expectedCommit);
    }
}
