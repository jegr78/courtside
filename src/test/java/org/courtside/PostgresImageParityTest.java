package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class PostgresImageParityTest {

    private static final Path DEPLOY = Path.of("deploy");
    private static final Path TESTCONTAINERS =
            Path.of("src/test/java/org/courtside/TestcontainersConfiguration.java");
    private static final Path BROWSER_JOURNEY_SETUP = Path.of("frontend/e2e/global-setup.ts");

    private static final Pattern POSTGRES_IMAGE =
            Pattern.compile("postgres:[\\w.-]+@sha256:[a-f0-9]{64}");

    @Test
    void whenTheDeploymentNamesPostgres_thenItIsPinnedByDigest() throws IOException {
        // when
        List<String> references = deploymentReferences();

        // then
        assertThat(references)
                .as("every compose file under deploy/ names one digest-pinned PostgreSQL")
                .isNotEmpty()
                .containsOnly(references.getFirst());
    }

    @Test
    void whenTheSuiteStartsPostgres_thenItUsesTheImageTheDeploymentNames() throws IOException {
        // given
        String deployed = deploymentReferences().getFirst();

        // then
        assertThat(reference(TESTCONTAINERS))
                .as("the database the integration tests qualify must be the one a club runs")
                .isEqualTo(deployed);
        assertThat(reference(BROWSER_JOURNEY_SETUP))
                .as("the database the browser journeys qualify must be the one a club runs")
                .isEqualTo(deployed);
    }

    private static List<String> deploymentReferences() throws IOException {
        List<String> references = new ArrayList<>();
        try (var files = Files.list(DEPLOY)) {
            for (Path file : files.filter(path -> path.getFileName().toString().endsWith(".yaml"))
                    .toList()) {
                references.addAll(matches(Files.readString(file)));
            }
        }
        return references;
    }

    private static String reference(Path source) throws IOException {
        List<String> found = matches(Files.readString(source));
        assertThat(found)
                .as("%s names exactly one PostgreSQL image, pinned by digest", source)
                .hasSize(1);
        return found.getFirst();
    }

    private static List<String> matches(String source) {
        Matcher matcher = POSTGRES_IMAGE.matcher(source);
        return matcher.results().map(java.util.regex.MatchResult::group).toList();
    }
}
