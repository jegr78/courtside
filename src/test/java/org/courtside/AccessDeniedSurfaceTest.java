package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.TreeSet;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class AccessDeniedSurfaceTest {

    private static final Path SOURCES = Path.of("src/main/java");
    private static final String PROBLEM = "urn:courtside:error:access-denied";
    private static final List<String> INSIDE_AN_OPERATION = List.of(
            "AccessDeniedException", "@PreAuthorize", "@PostAuthorize", "@Secured",
            "@RolesAllowed", "EnableMethodSecurity");

    private static final String FILTER_CHAIN_HANDLER =
            "org/courtside/identity/internal/ProblemDetailAccessDeniedHandler.java";

    @Test
    void whenReadingEverySourceNamingTheAccessDeniedProblem_thenOnlyTheFilterChainHandlerDoes()
            throws IOException {
        // when
        TreeSet<String> naming = sourcesContaining(PROBLEM);

        // then
        assertThat(naming)
                .as("a second producer of %s would let a client tell one refusal from another only"
                        + " by reading the detail. The web client repeats a write refused with this"
                        + " problem, so a new producer must be reachable before an operation runs"
                        + " or the repeat applies its side effect twice.", PROBLEM)
                .containsExactly(FILTER_CHAIN_HANDLER);
    }

    @Test
    void whenReadingEveryWayToRefuseInsideAnOperation_thenNothingButTheHandlerUsesOne()
            throws IOException {
        // given
        TreeSet<String> refusing = new TreeSet<>();

        // when
        for (String marker : INSIDE_AN_OPERATION) {
            refusing.addAll(sourcesContaining(marker));
        }

        // then
        assertThat(refusing)
                .as("method security and a thrown AccessDeniedException both refuse after a request"
                        + " has reached its operation, where a partial write may already stand."
                        + " Refuse in the filter chain instead, or the web client's repeat of a"
                        + " refused write stops being harmless.")
                .containsExactly(FILTER_CHAIN_HANDLER);
    }

    private static TreeSet<String> sourcesContaining(String marker) throws IOException {
        try (Stream<Path> sources = Files.walk(SOURCES)) {
            return sources.filter(path -> path.toString().endsWith(".java"))
                    .filter(path -> contains(path, marker))
                    .map(path -> SOURCES.relativize(path).toString())
                    .collect(TreeSet::new, TreeSet::add, TreeSet::addAll);
        }
    }

    private static boolean contains(Path source, String marker) {
        try {
            return Files.readString(source).contains(marker);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + source, e);
        }
    }
}
