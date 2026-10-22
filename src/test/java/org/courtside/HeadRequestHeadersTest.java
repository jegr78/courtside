package org.courtside;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.servlet.handler.SimpleUrlHandlerMapping;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class HeadRequestHeadersTest extends AbstractIntegrationTest {

    private static final List<String> API_READS = List.of("/api/public/config", "/api/openapi.yaml");

    private static final Path BUILD = TestApplicationBuild.create();

    private final HttpClient anonymous = HttpClient.newHttpClient();

    @LocalServerPort
    private int port;

    @Autowired
    @Qualifier("applicationShellMapping")
    private SimpleUrlHandlerMapping shellMapping;

    @DynamicPropertySource
    static void serveTheBuild(DynamicPropertyRegistry registry) {
        registry.add(TestApplicationBuild.STATIC_LOCATIONS, () -> BUILD.toUri().toString());
    }

    @AfterAll
    static void removeTheBuild() {
        TestApplicationBuild.delete(BUILD);
    }

    @Test
    void whenAClientRouteIsRequestedWithHead_thenItAnswersWithEveryHeaderOfGet() {
        // given
        List<String> routes = shellRoutes();

        // when / then
        assertThat(routes).as("the shell routes").contains("/", "/my-bookings");
        assertThat(routes).allSatisfy(route -> answersHeadLikeGet(route, true));
    }

    @Test
    void whenAClientRouteIsRequestedWithGet_thenItAnswersExactlyAsTheShellDocumentDoes() {
        // given
        HttpResponse<String> document = send("GET", "/index.html");
        Map<String, String> expected = new TreeMap<>(headers(document));
        expected.put("content-language", "de");

        // when / then
        assertThat(shellRoutes()).allSatisfy(route -> {
            HttpResponse<String> shell = send("GET", route);
            assertThat(shell.body()).as("GET %s serves the shell document", route).isEqualTo(document.body());
            assertThat(headers(shell))
                    .as("GET %s carries the headers of GET /index.html and the locale a rendered view stated", route)
                    .isEqualTo(expected);
        });
    }

    @Test
    void whenABuiltFileIsRequestedWithHead_thenItAnswersWithEveryHeaderOfGet() {
        // given
        List<String> files = TestApplicationBuild.staticPaths();

        // when / then
        assertThat(files).as("the inventoried build files").contains("/index.html", "/icon.svg");
        assertThat(files).allSatisfy(file -> answersHeadLikeGet(file, !file.startsWith("/assets/")));
    }

    @Test
    void whenAServedResourceOrAnApiReadIsRequestedWithHead_thenItAnswersWithEveryHeaderOfGet() {
        // given
        List<String> served = servedResources();

        // when / then
        assertThat(served).as("the inventoried metadata resources").contains("/manifest.webmanifest");
        assertThat(served).allSatisfy(path -> answersHeadLikeGet(path, false));
        assertThat(API_READS).allSatisfy(path -> answersHeadLikeGet(path, false));
    }

    private void answersHeadLikeGet(String path, boolean uncached) {
        HttpResponse<String> get = send("GET", path);
        HttpResponse<String> head = send("HEAD", path);
        assertThat(get.statusCode()).as("GET %s is served", path).isEqualTo(200);
        assertThat(headers(get)).as("GET %s carries the application's security headers", path)
                .containsAllEntriesOf(ApplicationResponseHeaders.SECURITY);
        if (uncached) {
            assertThat(headers(get)).as("GET %s forbids caching", path).containsAllEntriesOf(ApplicationResponseHeaders.UNCACHED);
        }
        assertThat(head.statusCode()).as("HEAD %s answers as GET does", path).isEqualTo(200);
        assertThat(headers(head)).as("HEAD %s carries every header of GET", path).isEqualTo(headers(get));
    }

    private static Map<String, String> headers(HttpResponse<String> response) {
        return ApplicationResponseHeaders.comparable(response.headers());
    }

    private List<String> shellRoutes() {
        return shellMapping.getUrlMap().keySet().stream()
                .map(route -> route.replaceAll("\\{[^}]+}", "probe"))
                .sorted()
                .toList();
    }

    private static List<String> servedResources() {
        try {
            JsonNode inventory = new ObjectMapper().readTree(
                    Files.readString(Path.of("security/published-web-resources.json")));
            return inventory.get("servedResources").values().stream()
                    .map(resource -> resource.get("path").asString()).toList();
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }

    private HttpResponse<String> send(String method, String path) {
        try {
            return anonymous.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                    .method(method, HttpRequest.BodyPublishers.noBody()).build(),
                    HttpResponse.BodyHandlers.ofString());
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exception);
        }
    }
}
