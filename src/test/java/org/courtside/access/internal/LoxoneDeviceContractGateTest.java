package org.courtside.access.internal;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class LoxoneDeviceContractGateTest {

    private static final List<Path> BUILD_AND_DEPLOYMENT = List.of(Path.of(".github"), Path.of("pom.xml"),
            Path.of("deploy"), Path.of("tools"), Path.of("frontend/package.json"), Path.of("src/main/resources"));

    @Test
    void whenTheDeviceTestIsRead_thenItRunsOnlyWithTheGateVariableSetToOne() {
        // when
        EnabledIfEnvironmentVariable gate = LoxoneDeviceContractTest.class
                .getAnnotation(EnabledIfEnvironmentVariable.class);

        // then
        assertThat(gate).as("the device test is gated by an environment variable").isNotNull();
        assertThat(gate.named()).isEqualTo("COURTSIDE_LOXONE_DEVICE_TEST");
        assertThat(gate.matches()).isEqualTo("1");
    }

    @Test
    void whenTheBuildAndDeploymentFilesAreRead_thenNoneSetsTheGateVariable() throws IOException {
        // when
        List<Path> naming;
        try (Stream<Path> files = BUILD_AND_DEPLOYMENT.stream().filter(Files::exists)
                .flatMap(LoxoneDeviceContractGateTest::walk)) {
            naming = files.filter(Files::isRegularFile)
                    .filter(file -> read(file).contains(LoxoneDeviceContractTest.GATE)).toList();
        }

        // then
        assertThat(naming).as("no workflow, profile or deployment ever runs the device test").isEmpty();
    }

    private static Stream<Path> walk(Path root) {
        try {
            return Files.walk(root);
        } catch (IOException unreadable) {
            throw new AssertionError("could not read " + root, unreadable);
        }
    }

    private static String read(Path file) {
        try {
            return new String(Files.readAllBytes(file), StandardCharsets.ISO_8859_1);
        } catch (IOException unreadable) {
            throw new AssertionError("could not read " + file, unreadable);
        }
    }
}
