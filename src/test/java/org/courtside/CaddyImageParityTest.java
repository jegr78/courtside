package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.MatchResult;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class CaddyImageParityTest {

    private static final Path DEPLOY = Path.of("deploy");
    private static final Path DEPLOYMENT_READ_BY_THE_CONSUMERS = Path.of("deploy/compose.yaml");
    private static final Path ASSESSMENT_RESERVATION = Path.of("tools/security-environment.mjs");
    private static final Path BROWSER_JOURNEY_SETUP = Path.of("frontend/e2e/global-setup.ts");
    private static final Path OPERATOR_INSTRUCTIONS = Path.of("docs/security-environment.md");

    private static final Pattern CADDY_IMAGE = Pattern.compile("caddy:[\\w.-]+@sha256:[a-f0-9]{64}");

    @Test
    void whenTheDeploymentNamesCaddy_thenEveryComposeFileNamesTheSameDigest() throws IOException {
        // when
        List<String> references = deploymentReferences();

        // then
        assertThat(references)
                .as("every compose file under deploy/ names one digest-pinned Caddy")
                .isNotEmpty()
                .containsOnly(references.getFirst());
    }

    // Behind a different proxy build the browser journeys and the assessment qualify something the
    // club does not run and report green for it, and the instructions hand an operator a dead digest.
    @Test
    void whenSomethingElseNamesCaddy_thenItReadsTheDeploymentRatherThanRepeatingIt() throws IOException {
        // then
        for (Path consumer : List.of(ASSESSMENT_RESERVATION, BROWSER_JOURNEY_SETUP, OPERATOR_INSTRUCTIONS)) {
            assertThat(matches(Files.readString(consumer)))
                    .as("%s reads the image the deployment names; it does not carry its own", consumer)
                    .isEmpty();
        }
    }

    @Test
    void whenAConsumerReadsTheDeployment_thenItFindsTheFileItReads() {
        // then
        assertThat(DEPLOYMENT_READ_BY_THE_CONSUMERS)
                .as("both readers name this file; a rename here breaks them silently")
                .exists();
    }

    private static List<String> deploymentReferences() throws IOException {
        List<String> references = new ArrayList<>();
        try (var files = Files.list(DEPLOY)) {
            for (Path file : files.filter(path -> path.getFileName().toString().endsWith(".yaml")).toList()) {
                references.addAll(matches(Files.readString(file)));
            }
        }
        return references;
    }

    private static List<String> matches(String source) {
        Matcher matcher = CADDY_IMAGE.matcher(source);
        return matcher.results().map(MatchResult::group).toList();
    }
}
