package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.TreeSet;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class IllegalArgumentSurfaceTest {

    private static final String THROW = "throw new IllegalArgumentException";

    // Value types only.
    private static final List<String> VALUE_TYPES_ALLOWED_TO_THROW = List.of(
            "org/courtside/booking/BookingRuleCheck.java",
            "org/courtside/booking/series/MoveRequest.java",
            "org/courtside/booking/series/SeriesRule.java",
            "org/courtside/config/BookingSlotDuration.java",
            "org/courtside/shared/CodedDomainFailure.java",
            "org/courtside/shared/ProblemType.java",
            "org/courtside/shared/TimeSlot.java");

    @Test
    void whenReadingEveryIllegalArgumentExceptionThrown_thenEachSitsInAValueType() throws IOException {
        // given
        TreeSet<String> throwing = new TreeSet<>();

        // when
        try (Stream<Path> sources = Files.walk(Path.of("src/main/java"))) {
            sources.filter(path -> path.toString().endsWith(".java"))
                    .filter(IllegalArgumentSurfaceTest::throwsIllegalArgument)
                    .map(path -> Path.of("src/main/java").relativize(path).toString())
                    .forEach(throwing::add);
        }

        // then
        assertThat(throwing)
                .as("a service, controller or entity that throws IllegalArgumentException reports a"
                        + " user-reachable failure with no i18n code. Give it a typed failure"
                        + " extending DomainFailure, or a Bean Validation constraint if a field can"
                        + " express it. Only a value type's own invariant belongs on this list.")
                .containsExactlyInAnyOrderElementsOf(VALUE_TYPES_ALLOWED_TO_THROW);
    }

    @Test
    void whenReadingEveryValueTypeOnTheList_thenItStillThrowsAndTheListHasNoFossils() throws IOException {
        // given
        TreeSet<String> notThrowing = new TreeSet<>();

        // when
        for (String allowed : VALUE_TYPES_ALLOWED_TO_THROW) {
            Path source = Path.of("src/main/java").resolve(allowed);
            if (!Files.exists(source) || !throwsIllegalArgument(source)) {
                notThrowing.add(allowed);
            }
        }

        // then
        assertThat(notThrowing)
                .as("remove a value type from the list once it no longer throws")
                .isEmpty();
    }

    private static boolean throwsIllegalArgument(Path source) {
        try {
            return Files.readString(source).contains(THROW);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + source, e);
        }
    }
}
