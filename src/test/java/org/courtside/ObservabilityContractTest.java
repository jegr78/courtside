package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class ObservabilityContractTest {

    private static final Path PROJECT = Path.of(System.getProperty("user.dir"));

    @Test
    void whenInspectingDependencies_thenOpenTelemetryTracingAndMetricsUseBootManagedArtifacts() throws IOException {
        // given
        String pom = Files.readString(PROJECT.resolve("pom.xml"));

        // when / then
        assertThat(pom)
                .contains("<artifactId>spring-boot-starter-opentelemetry</artifactId>")
                .contains("<artifactId>micrometer-registry-otlp</artifactId>");
    }

    @Test
    void whenInspectingDefaultConfiguration_thenTelemetryExportRequiresExplicitOptIn() throws IOException {
        // given
        String configuration = Files.readString(PROJECT.resolve("src/main/resources/application.yaml"));

        // when / then
        assertThat(configuration)
                .contains("enabled: ${COURTSIDE_OTLP_ENABLED:false}")
                .contains("endpoint: ${COURTSIDE_OTLP_TRACES_ENDPOINT:http://localhost:4318/v1/traces}")
                .contains("url: ${COURTSIDE_OTLP_METRICS_ENDPOINT:http://localhost:4318/v1/metrics}")
                .contains("probability: ${COURTSIDE_TRACING_SAMPLING_PROBABILITY:0.1}");
    }

    @Test
    void whenInspectingManagementExposure_thenOnlyHealthIsPubliclyExposed() throws IOException {
        // given
        String configuration = Files.readString(PROJECT.resolve("src/main/resources/application.yaml"));

        // when / then
        assertThat(configuration).contains("include: health");
        assertThat(configuration).doesNotContain("include: health,metrics", "include: health,prometheus");
    }

    @Test
    void whenInspectingReferenceDeployment_thenEveryTelemetrySettingReachesTheApplication() throws IOException {
        // given
        String compose = Files.readString(PROJECT.resolve("deploy/compose.yaml"));

        // when / then
        assertThat(compose)
                .contains("COURTSIDE_OTLP_ENABLED: ${COURTSIDE_OTLP_ENABLED:-false}")
                .contains("COURTSIDE_OTLP_TRACES_ENDPOINT: ${COURTSIDE_OTLP_TRACES_ENDPOINT:-")
                .contains("COURTSIDE_OTLP_METRICS_ENDPOINT: ${COURTSIDE_OTLP_METRICS_ENDPOINT:-")
                .contains("COURTSIDE_TRACING_SAMPLING_PROBABILITY: "
                        + "${COURTSIDE_TRACING_SAMPLING_PROBABILITY:-0.1}");
    }
}
