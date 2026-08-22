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
    private static final Path DEPLOYMENT_READ_BY_THE_SUITE = Path.of("deploy/compose.yaml");

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

    // A second literal cannot be updated by whatever bumps the first, so the suite reads the
    // deployment instead and this asserts that it stays the only place the digest is written.
    @Test
    void whenTheSuiteStartsPostgres_thenItReadsTheDeploymentRatherThanRepeatingIt() throws IOException {
        // then
        assertThat(matches(Files.readString(TESTCONTAINERS)))
                .as("%s reads the image the deployment names; it does not carry its own", TESTCONTAINERS)
                .isEmpty();
        assertThat(matches(Files.readString(BROWSER_JOURNEY_SETUP)))
                .as("%s reads the image the deployment names; it does not carry its own",
                        BROWSER_JOURNEY_SETUP)
                .isEmpty();
    }

    @Test
    void whenTheSuiteReadsTheDeployment_thenItFindsTheFileItReads() {
        // then
        assertThat(DEPLOYMENT_READ_BY_THE_SUITE)
                .as("both readers name this file; a rename here breaks them silently")
                .exists();
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

    private static List<String> matches(String source) {
        Matcher matcher = POSTGRES_IMAGE.matcher(source);
        return matcher.results().map(java.util.regex.MatchResult::group).toList();
    }
}
