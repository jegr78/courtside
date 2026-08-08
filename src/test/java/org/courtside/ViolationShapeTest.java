package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.TreeSet;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

// A translatable failure travels in exactly one shape: a violations array of {code, params}
// entries, even when there is only ever one entry. The alternative — a code and params sitting on
// the problem itself — was in use alongside it, so a frontend resolving "a violation" against the
// message bundle needed two code paths and a null check rather than one.
//
// The shape is not something a type system can hold: any failure may override properties() and put
// whatever it likes on the body. This test is the boundary instead.
class ViolationShapeTest {

    // The only two files allowed to write a "code" map key.
    //
    // DomainFailure builds the violations entry that every coded failure goes through.
    // SharedExceptionHandler builds two arrays: violations, for the framework failures that carry
    // a translatable code, and fieldErrors, whose entries are {field, code, params} — a violation
    // that also names the input it came from.
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
        // given — the array is set as one property; a code set directly on the ProblemDetail is
        // the top-level shape by definition
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
