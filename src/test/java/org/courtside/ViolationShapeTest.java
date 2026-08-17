package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.TreeSet;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class ViolationShapeTest {

    // The only two files allowed to write a "code" map key.
    private static final List<String> ALLOWED_TO_WRITE_A_CODE = List.of(
            "org/courtside/shared/DomainFailure.java",
            "org/courtside/shared/web/SharedExceptionHandler.java");

    @Test
    void whenReadingEveryPlaceThatWritesACode_thenOnlyTheTwoBuildersDoIt() throws IOException {
        // given
        TreeSet<String> writers = new TreeSet<>();

        // when
        try (Stream<Path> sources = Files.walk(Path.of("src/main/java"))) {
            sources.filter(path -> path.toString().endsWith(".java"))
                    .filter(path -> contains(path, "\"code\""))
                    .map(path -> Path.of("src/main/java").relativize(path).toString())
                    .forEach(writers::add);
        }

        // then
        assertThat(writers)
                .as("a failure that puts a code on the problem body itself brings back the second"
                        + " shape this test exists to prevent. Carry the code through"
                        + " CodedDomainFailure, or build the entry with DomainFailure.oneViolation.")
                .containsExactlyInAnyOrderElementsOf(ALLOWED_TO_WRITE_A_CODE);
    }

    @Test
    void whenReadingEveryAdvice_thenNoneSetsACodeOnTheProblemItself() throws IOException {
        // given
        TreeSet<String> offenders = new TreeSet<>();

        // when
        try (Stream<Path> sources = Files.walk(Path.of("src/main/java"))) {
            sources.filter(path -> path.toString().endsWith(".java"))
                    .filter(path -> contains(path, "setProperty(\"code\""))
                    .map(path -> Path.of("src/main/java").relativize(path).toString())
                    .forEach(offenders::add);
        }

        // then
        assertThat(offenders)
                .as("set a violations array instead: setProperty(\"violations\", List.of(...))")
                .isEmpty();
    }

    private static boolean contains(Path source, String needle) {
        try {
            return Files.readString(source).contains(needle);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + source, e);
        }
    }
}
