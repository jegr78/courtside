package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class ProblemTypeUriTest {

    private static final Pattern TYPE_LITERAL =
            Pattern.compile("setType\\(URI\\.create\\(\"([^\"]+)\"\\)\\)");
    private static final Pattern ALLOWED = Pattern.compile("urn:courtside:error:[a-z0-9-]+");

    // The complete set of problem type URNs src/main is allowed to produce today. A new slug, a
    // near-synonym or a silent rename must land here deliberately, not slip past a shape-only check.
    private static final List<String> KNOWN_SLUGS = List.of(
            "urn:courtside:error:access-denied",
            "urn:courtside:error:booking-not-found",
            "urn:courtside:error:booking-not-owned",
            "urn:courtside:error:booking-rules-violated",
            "urn:courtside:error:card-label-taken",
            "urn:courtside:error:card-not-found",
            "urn:courtside:error:card-role-required",
            "urn:courtside:error:constraint-violation",
            "urn:courtside:error:court-not-found",
            "urn:courtside:error:court-number-taken",
            "urn:courtside:error:court-unavailable",
            "urn:courtside:error:invalid-opening-window",
            "urn:courtside:error:invalid-request",
            "urn:courtside:error:malformed-request-body",
            "urn:courtside:error:membership-type-name-taken",
            "urn:courtside:error:membership-type-not-found",
            "urn:courtside:error:method-not-supported",
            "urn:courtside:error:missing-parameter",
            "urn:courtside:error:not-acceptable",
            "urn:courtside:error:parameter-type-mismatch",
            "urn:courtside:error:participants-invalid",
            "urn:courtside:error:rule-parameter-invalid",
            "urn:courtside:error:rule-set-inactive",
            "urn:courtside:error:rule-set-name-taken",
            "urn:courtside:error:rule-set-not-found",
            "urn:courtside:error:rule-set-unresolvable",
            "urn:courtside:error:series-move-conflict",
            "urn:courtside:error:series-not-found",
            "urn:courtside:error:unauthenticated",
            "urn:courtside:error:unmapped-path",
            "urn:courtside:error:unsupported-media-type",
            "urn:courtside:error:validation-failed");

    @Test
    void whenReadingEveryProblemTypeUri_thenNoneNamesAHostThisProductDoesNotOwn() throws IOException {
        // given — a club runs its own instance under its own domain, so an http type URI would
        // name a host nobody operates and could later be registered by someone else
        try (Stream<Path> sources = Files.walk(Path.of("src/main/java"))) {
            List<String> types = sources
                    .filter(path -> path.toString().endsWith(".java"))
                    .flatMap(ProblemTypeUriTest::typeLiteralsIn)
                    .toList();

            // when / then
            assertThat(types).isNotEmpty();
            assertThat(types)
                    .as("every ProblemDetail type must be a urn:courtside:error:<slug> URN")
                    .allMatch(type -> ALLOWED.matcher(type).matches());
        }
    }

    @Test
    void whenReadingEveryProblemTypeUri_thenTheSlugSetMatchesKnownSlugsExactly() throws IOException {
        // given
        try (Stream<Path> sources = Files.walk(Path.of("src/main/java"))) {
            List<String> types = sources
                    .filter(path -> path.toString().endsWith(".java"))
                    .flatMap(ProblemTypeUriTest::typeLiteralsIn)
                    .toList();

            // when / then — a new slug must be added here deliberately before it can ship
            assertThat(types).containsExactlyInAnyOrderElementsOf(KNOWN_SLUGS);
        }
    }

    private static Stream<String> typeLiteralsIn(Path source) {
        String content;
        try {
            content = Files.readString(source);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + source, e);
        }
        Matcher matcher = TYPE_LITERAL.matcher(content);
        return matcher.results().map(result -> result.group(1));
    }
}
