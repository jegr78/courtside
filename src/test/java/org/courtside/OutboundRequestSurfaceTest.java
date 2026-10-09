package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.TreeSet;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class OutboundRequestSurfaceTest {

    private static final List<String> CLIENT_CONSTRUCTIONS = List.of(
            "HttpClient.newBuilder", "HttpClient.newHttpClient", "RestClient.create", "RestClient.builder",
            "WebClient.create", "WebClient.builder", "new RestTemplate", ".openConnection(",
            "new Socket(", "SocketChannel.open");

    // The breach endpoint, whose destination is configuration and never a request, and the start-up
    // warm-up, which reaches nothing but this instance's own port on the loopback address.
    private static final List<String> CALLS_OUT = List.of(
            "org/courtside/identity/internal/HaveIBeenPwnedPasswordLookup.java",
            "org/courtside/shared/internal/LoopbackReadStep.java");

    private static final Pattern DESTINATION = Pattern.compile("URI\\.create\\(\\s*\"([^\"]*)\"");

    @Test
    void whenReadingEveryOutboundClient_thenOnlyTheBreachEndpointAndTheInstanceItselfAreReached() throws IOException {
        // given
        TreeSet<String> callers = new TreeSet<>();

        // when
        try (Stream<Path> sources = Files.walk(Path.of("src/main/java"))) {
            sources.filter(path -> path.toString().endsWith(".java"))
                    .filter(OutboundRequestSurfaceTest::constructsAClient)
                    .map(path -> Path.of("src/main/java").relativize(path).toString())
                    .forEach(callers::add);
        }

        // then
        assertThat(callers)
                .as("a second outbound client gives the server a destination nothing declares."
                        + " Route it through configuration the operator can see, and add it here"
                        + " with the reason, so the list stays the whole allowlist.")
                .containsExactlyInAnyOrderElementsOf(CALLS_OUT);
    }

    @Test
    void whenReadingTheBreachEndpoint_thenItsDestinationComesFromConfigurationAlone() throws IOException {
        // given
        String properties = Files.readString(
                Path.of("src/main/java/org/courtside/identity/internal/PasswordPolicyProperties.java"));
        String defaults = Files.readString(Path.of("src/main/resources/application.yaml"));

        // then
        assertThat(properties).contains("breachEndpoint");
        assertThat(defaults).contains("breach-endpoint: ${COURTSIDE_PASSWORD_BREACH_ENDPOINT:");
    }

    @Test
    void whenReadingTheWarmUpClient_thenEveryDestinationIsTheLoopbackAddress() throws IOException {
        // given
        String source = Files.readString(
                Path.of("src/main/java/org/courtside/shared/internal/LoopbackReadStep.java"));

        // when
        List<String> destinations = DESTINATION.matcher(source).results().map(match -> match.group(1)).toList();

        // then
        assertThat(source.split("URI\\.create\\(", -1).length - 1)
                .as("every destination the warm-up builds must start from a literal this test can read")
                .isEqualTo(destinations.size());
        assertThat(destinations)
                .as("the warm-up may reach this instance's own port on the loopback address and nothing else")
                .isNotEmpty()
                .allMatch(destination -> destination.equals("http://127.0.0.1:"));
    }

    private static boolean constructsAClient(Path source) {
        try {
            String text = Files.readString(source);
            return CLIENT_CONSTRUCTIONS.stream().anyMatch(text::contains);
        } catch (IOException unreadable) {
            throw new IllegalStateException("a source file under src/main/java could not be read", unreadable);
        }
    }
}
