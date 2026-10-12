package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
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
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class HeadRequestHeadersTest extends AbstractIntegrationTest {

    private static final String CONTENT_SECURITY_POLICY = "content-security-policy";

    private static final String CACHE_CONTROL = "cache-control";

    private static final Map<String, String> FIXED_HEADERS = Map.of(
            CONTENT_SECURITY_POLICY, "default-src 'self'; object-src 'none'; img-src 'self' https:; "
                    + "style-src 'self'; script-src 'self'; connect-src 'self'; "
                    + "manifest-src 'self'; worker-src 'self'; "
                    + "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
            "x-content-type-options", "nosniff",
            "x-frame-options", "DENY",
            "referrer-policy", "strict-origin-when-cross-origin");

    private static final Map<String, String> UNCACHED = Map.of(
            CACHE_CONTROL, "no-cache, no-store, max-age=0, must-revalidate",
            "pragma", "no-cache",
            "expires", "0");

    private static final List<String> API_READS = List.of("/api/public/config", "/api/openapi.yaml");

    private static final JsonNode INVENTORY = new ObjectMapper().readTree(
            read(Path.of("security/published-web-resources.json")));

    private static final Path BUILD = createBuild();

    private final HttpClient anonymous = HttpClient.newHttpClient();

    @LocalServerPort
    private int port;

    @Autowired
    private List<SimpleUrlHandlerMapping> urlMappings;

    @DynamicPropertySource
    static void serveTheBuild(DynamicPropertyRegistry registry) {
        registry.add("spring.web.resources.static-locations", () -> BUILD.toUri().toString());
    }

    @Test
    void whenAClientRouteIsRequestedWithHead_thenItCarriesTheSecurityAndCacheHeadersOfGet() {
        // given
        List<String> routes = shellRoutes();

        // when / then
        assertThat(routes).as("the shell routes the view controllers forward").contains("/", "/my-bookings");
        assertThat(routes).allSatisfy(route -> answersHeadLikeGet(route, true));
    }

    @Test
    void whenABuiltFileIsRequestedWithHead_thenItCarriesTheSecurityAndCacheHeadersOfGet() {
        // given
        List<String> files = staticPaths();

        // when / then
        assertThat(files).as("the inventoried build files").contains("/index.html", "/icon.svg");
        assertThat(files).allSatisfy(file -> answersHeadLikeGet(file, true));
    }

    @Test
    void whenAServedResourceOrAnApiReadIsRequestedWithHead_thenItCarriesTheSecurityHeadersOfGet() {
        // given
        List<String> served = INVENTORY.get("servedResources").values().stream()
                .map(resource -> resource.get("path").asString()).toList();

        // when / then
        assertThat(served).as("the inventoried metadata resources").contains("/manifest.webmanifest");
        assertThat(served).allSatisfy(path -> answersHeadLikeGet(path, false));
        assertThat(API_READS).allSatisfy(path -> answersHeadLikeGet(path, false));
    }

    private void answersHeadLikeGet(String path, boolean uncached) {
        HttpResponse<String> get = send("GET", path);
        HttpResponse<String> head = send("HEAD", path);
        assertThat(get.statusCode()).as("GET %s is served", path).isEqualTo(200);
        assertThat(head.statusCode()).as("HEAD %s answers as GET does", path).isEqualTo(200);
        assertThat(headers(get, FIXED_HEADERS.keySet().stream().toList()))
                .as("GET %s carries the application's security headers", path)
                .isEqualTo(new TreeMap<>(FIXED_HEADERS));
        if (uncached) {
            assertThat(headers(get, UNCACHED.keySet().stream().toList()))
                    .as("GET %s forbids caching", path).isEqualTo(new TreeMap<>(UNCACHED));
        }
        List<String> compared = List.of(CONTENT_SECURITY_POLICY, "x-content-type-options",
                "x-frame-options", "referrer-policy", CACHE_CONTROL, "pragma", "expires");
        assertThat(headers(head, compared)).as("HEAD %s carries the security and cache headers of GET", path)
                .isEqualTo(headers(get, compared));
    }

    private static Map<String, String> headers(HttpResponse<String> response, List<String> names) {
        return names.stream().collect(Collectors.toMap(name -> name,
                name -> String.join(" | ", response.headers().allValues(name)), (a, b) -> a, TreeMap::new));
    }

    private List<String> shellRoutes() {
        return urlMappings.stream()
                .min(Comparator.comparingInt(SimpleUrlHandlerMapping::getOrder))
                .orElseThrow()
                .getUrlMap()
                .keySet()
                .stream()
                .map(route -> route.replaceAll("\\{[^}]+}", "probe"))
                .sorted()
                .toList();
    }

    private static List<String> staticPaths() {
        return INVENTORY.get("anonymousStaticPaths").values().stream()
                .map(pattern -> pattern.asString().replace("**", "probe.js").replace("*", "probe"))
                .sorted()
                .toList();
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

    private static Path createBuild() {
        try {
            Path build = Files.createTempDirectory(Files.createDirectories(Path.of("target")), "head-build");
            for (String path : staticPaths()) {
                Path file = build.resolve(path.substring(1));
                Files.createDirectories(file.getParent());
                Files.writeString(file, "built " + path);
            }
            return build;
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }

    private static String read(Path path) {
        try {
            return Files.readString(path);
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }
}
