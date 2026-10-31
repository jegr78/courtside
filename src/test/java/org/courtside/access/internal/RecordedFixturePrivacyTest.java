package org.courtside.access.internal;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class RecordedFixturePrivacyTest {

    @TempDir
    Path copy;

    @Test
    void whenTheRecordedFixturesAreScanned_thenNoneHoldsAValueOutsideTheAllowlist() {
        // when
        List<String> violations = RecordedFixtures.violations(RecordedFixtures.RECORDED);

        // then
        assertThat(violations).as("every string under recorded/ is a placeholder, a protocol word or a known value")
                .isEmpty();
    }

    static Stream<Arguments> planted() {
        return Stream.of(
                Arguments.of("{\"LL\":{\"value\":{\"name\":\"Example Tennis Club\"}}}",
                        "planted $.LL.value.name holds a string", "example tennis club"),
                Arguments.of("{\"LL\":{\"control\":\"jdev/sps/ü\"}}",
                        "planted $.LL.control holds a string", "ü"),
                Arguments.of("{\"LL\":{\"control\":\"<host-1>@<host-2>\"}}",
                        "planted $.LL.control holds a string", "@"),
                Arguments.of("{\"LL\":{\"doorName\":\"\"}}",
                        "planted $.LL.<redacted> has a key", "doorname"),
                Arguments.of("{\"LL\":{\"value\":42}}",
                        "planted $.LL.value holds a number", "42"),
                Arguments.of("{\"LL\":{\"value\":{\"keycodes\":[{\"code\":4826}]}}}",
                        "planted $.LL.value.keycodes[0].code holds a number", "4826"));
    }

    @ParameterizedTest
    @MethodSource("planted")
    void givenAPlantedValueInACopyOfTheFixtures_whenScanned_thenItIsNamedByFileAndPathButNotByValue(
            String content, String named, String value) throws IOException {
        // given
        copyRecorded();
        Files.writeString(copy.resolve("planted.json"), content);

        // when
        List<String> violations = RecordedFixtures.violations(copy);

        // then
        assertThat(violations).as("the planted value is found").anySatisfy(violation ->
                assertThat(violation).startsWith(named));
        assertThat(String.join("; ", violations).toLowerCase(Locale.ROOT)).as("the finding never repeats the value")
                .doesNotContain(value);
    }

    @Test
    void givenAKeyCarryingASecret_whenScanned_thenThePathRedactsItAndTheWalkStopsThere() throws IOException {
        // given
        Files.writeString(copy.resolve("planted.json"),
                "{\"LL\":{\"COURTSIDE-SERVICE-door\":{\"motto\":\"Game, set, match\"}}}");

        // when
        List<String> unknown = RecordedFixtures.violations(copy);
        List<String> secrets = RecordedFixtures.secretViolations(copy, List.of("courtside-service"));

        // then
        assertThat(unknown).as("the key is flagged once and nothing beneath it is walked")
                .containsExactly("planted $.LL.<redacted> has a key outside the protocol keys");
        assertThat(secrets).as("the secret's key is redacted and nothing beneath it is walked")
                .containsExactly("planted $.LL.<redacted> has a key that carries a configured secret");
    }

    private void copyRecorded() throws IOException {
        if (!Files.isDirectory(RecordedFixtures.RECORDED)) {
            return;
        }
        try (Stream<Path> files = Files.list(RecordedFixtures.RECORDED)) {
            for (Path file : files.toList()) {
                Files.copy(file, copy.resolve(file.getFileName()));
            }
        }
    }
}
