package org.courtside;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class ProblemTypeUriTest {

    private static final Pattern TYPE_LITERAL =
            Pattern.compile("setType\\(URI\\.create\\(\"([^\"]+)\"\\)\\)");
    private static final Pattern ALLOWED = Pattern.compile("urn:courtside:error:[a-z0-9-]+");

    // Every URN src/main may produce. Two sources: a domain failure carries a ProblemType
    // constant, a framework exception only a literal in the advice answering for it.
    private static final List<String> KNOWN_FAILURE_SLUGS = List.of(
            "urn:courtside:error:account-not-found",
            "urn:courtside:error:booking-not-found",
            "urn:courtside:error:booking-not-owned",
            "urn:courtside:error:booking-rules-violated",
            "urn:courtside:error:card-label-taken",
            "urn:courtside:error:card-not-bookable",
            "urn:courtside:error:card-not-found",
            "urn:courtside:error:card-role-required",
            "urn:courtside:error:court-not-bookable",
            "urn:courtside:error:court-not-found",
            "urn:courtside:error:court-number-taken",
            "urn:courtside:error:court-unavailable",
            "urn:courtside:error:import-external-id-taken",
            "urn:courtside:error:import-external-reference-not-found",
            "urn:courtside:error:import-person-already-linked",
            "urn:courtside:error:import-person-not-found",
            "urn:courtside:error:import-preview-not-found",
            "urn:courtside:error:import-snapshot-blocked",
            "urn:courtside:error:import-snapshot-file-name-invalid",
            "urn:courtside:error:import-snapshot-unreadable",
            "urn:courtside:error:import-source-in-use",
            "urn:courtside:error:import-source-invalid",
            "urn:courtside:error:import-source-key-taken",
            "urn:courtside:error:import-source-not-found",
            "urn:courtside:error:invalid-membership-period",
            "urn:courtside:error:invalid-opening-window",
            "urn:courtside:error:last-administrator",
            "urn:courtside:error:idempotency-key-reused",
            "urn:courtside:error:login-rate-limited",
            "urn:courtside:error:opening-hours-grid-mismatch",
            "urn:courtside:error:membership-type-inactive",
            "urn:courtside:error:membership-type-name-taken",
            "urn:courtside:error:membership-type-not-found",
            "urn:courtside:error:participants-invalid",
            "urn:courtside:error:person-account-exists",
            "urn:courtside:error:person-not-found",
            "urn:courtside:error:roster-cursor-unknown",
            "urn:courtside:error:rule-parameter-invalid",
            "urn:courtside:error:rule-set-inactive",
            "urn:courtside:error:rule-set-name-taken",
            "urn:courtside:error:rule-set-not-found",
            "urn:courtside:error:rule-set-unresolvable",
            "urn:courtside:error:series-move-conflict",
            "urn:courtside:error:series-request-invalid",
            "urn:courtside:error:series-not-found",
            "urn:courtside:error:slot-duration-conflict",
            "urn:courtside:error:time-zone-conflict",
            "urn:courtside:error:username-taken");

    private static final List<String> KNOWN_ADVICE_SLUGS = List.of(
            "urn:courtside:error:access-denied",
            "urn:courtside:error:concurrent-modification",
            "urn:courtside:error:constraint-violation",
            "urn:courtside:error:malformed-request-body",
            "urn:courtside:error:method-not-supported",
            "urn:courtside:error:missing-parameter",
            "urn:courtside:error:not-acceptable",
            "urn:courtside:error:parameter-type-mismatch",
            "urn:courtside:error:payload-too-large",
            "urn:courtside:error:unauthenticated",
            "urn:courtside:error:unmapped-path",
            "urn:courtside:error:unsupported-media-type",
            "urn:courtside:error:validation-failed");

    @Test
    void whenReadingEveryProblemTypeUri_thenNoneNamesAHostThisProductDoesNotOwn() throws Exception {
        // given
        List<String> types = adviceTypeLiterals();
        List<String> failureTypes = failureSlugs();

        // when / then
        assertThat(types).isNotEmpty();
        assertThat(failureTypes).isNotEmpty();
        assertThat(types)
                .as("every ProblemDetail type an advice sets must be a urn:courtside:error:<slug> URN")
                .allMatch(type -> ALLOWED.matcher(type).matches());
        assertThat(failureTypes)
                .as("every DomainFailure's ProblemType must be a urn:courtside:error:<slug> URN")
                .allMatch(type -> ALLOWED.matcher(type).matches());
    }

    @Test
    void whenReadingEveryDomainFailuresProblemType_thenTheSlugSetMatchesKnownSlugsExactly()
            throws Exception {
        // when / then
        assertThat(failureSlugs()).containsExactlyInAnyOrderElementsOf(KNOWN_FAILURE_SLUGS);
    }

    @Test
    void whenReadingEveryProblemTypeAnAdviceSets_thenTheSlugSetMatchesKnownSlugsExactly()
            throws IOException {
        // when / then
        assertThat(adviceTypeLiterals()).containsExactlyInAnyOrderElementsOf(KNOWN_ADVICE_SLUGS);
    }

    @Test
    void whenReadingEveryDomainFailure_thenEachDeclaresItsOwnProblemTypeConstant() throws Exception {
        // given
        TreeSet<String> withoutConstant = new TreeSet<>();

        // when
        for (Class<?> failure : concreteDomainFailures()) {
            if (problemTypeConstantOf(failure) == null) {
                withoutConstant.add(failure.getSimpleName());
            }
        }

        // then
        assertThat(withoutConstant)
                .as("every concrete DomainFailure must declare a public static final ProblemType")
                .isEmpty();
    }

    private static List<String> failureSlugs() throws Exception {
        List<String> slugs = new java.util.ArrayList<>();
        for (Class<?> failure : concreteDomainFailures()) {
            ProblemType type = problemTypeConstantOf(failure);
            if (type != null) {
                slugs.add(type.uri().toString());
            }
        }
        return slugs;
    }

    private static ProblemType problemTypeConstantOf(Class<?> failure) throws Exception {
        for (Field field : failure.getDeclaredFields()) {
            if (field.getType() == ProblemType.class
                    && Modifier.isStatic(field.getModifiers())
                    && Modifier.isFinal(field.getModifiers())) {
                field.setAccessible(true);
                return (ProblemType) field.get(null);
            }
        }
        return null;
    }

    private static List<Class<?>> concreteDomainFailures() throws IOException, URISyntaxException {
        Path classesRoot = classesDirectory();
        List<Class<?>> failures = new java.util.ArrayList<>();
        try (Stream<Path> files = Files.walk(classesRoot)) {
            files.filter(path -> path.toString().endsWith(".class")).forEach(path -> {
                Class<?> type = loadClass(classesRoot, path);
                if (type != null && DomainFailure.class.isAssignableFrom(type)
                        && !Modifier.isAbstract(type.getModifiers())) {
                    failures.add(type);
                }
            });
        }
        return failures;
    }

    private static Class<?> loadClass(Path root, Path classFile) {
        String className = root.relativize(classFile).toString()
                .replace(java.io.File.separatorChar, '.')
                .replaceAll("\\.class$", "");
        try {
            return Class.forName(className, false, ProblemTypeUriTest.class.getClassLoader());
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static Path classesDirectory() throws URISyntaxException {
        URL marker = ProblemTypeUriTest.class.getProtectionDomain().getCodeSource().getLocation();
        return Path.of(marker.toURI()).getParent().resolve("classes");
    }

    private static List<String> adviceTypeLiterals() throws IOException {
        try (Stream<Path> sources = Files.walk(Path.of("src/main/java"))) {
            return sources
                    .filter(path -> path.toString().endsWith(".java"))
                    .flatMap(ProblemTypeUriTest::typeLiteralsIn)
                    .toList();
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
