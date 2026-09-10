package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.TreeSet;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class OutboundRequestSurfaceTest {

    private static final List<String> CLIENT_CONSTRUCTIONS = List.of(
            "HttpClient.newBuilder", "HttpClient.newHttpClient", "RestClient.create", "RestClient.builder",
            "WebClient.create", "WebClient.builder", "new RestTemplate", ".openConnection(",
            "new Socket(", "SocketChannel.open");

    // The one system the instance calls out to, whose destination is configuration and never a request.
    private static final List<String> CALLS_OUT = List.of(
            "org/courtside/identity/internal/HaveIBeenPwnedPasswordLookup.java");

    @Test
    void whenReadingEveryOutboundClient_thenOnlyTheConfiguredBreachEndpointIsReached() throws IOException {
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

    private static boolean constructsAClient(Path source) {
        try {
            String text = Files.readString(source);
            return CLIENT_CONSTRUCTIONS.stream().anyMatch(text::contains);
        } catch (IOException unreadable) {
            throw new IllegalStateException("a source file under src/main/java could not be read", unreadable);
        }
    }
}
