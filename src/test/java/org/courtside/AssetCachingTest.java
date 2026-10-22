package org.courtside;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AssetCachingTest extends AbstractIntegrationTest {

    private static final String IMMUTABLE = "max-age=31536000, public, immutable";

    private static final Path BUILD = TestApplicationBuild.create();

    private final HttpClient anonymous = HttpClient.newHttpClient();

    @LocalServerPort
    private int port;

    @DynamicPropertySource
    static void serveTheBuild(DynamicPropertyRegistry registry) {
        registry.add(TestApplicationBuild.STATIC_LOCATIONS, () -> BUILD.toUri().toString());
    }

    @AfterAll
    static void removeTheBuild() {
        TestApplicationBuild.delete(BUILD);
    }

    @Test
    void whenAContentHashedAssetIsRequested_thenABrowserMayKeepItForAYear() {
        // given
        List<String> assets = TestApplicationBuild.staticPaths().stream()
                .filter(path -> path.startsWith("/assets/")).toList();

        // when / then
        assertThat(assets).as("the inventoried assets").isNotEmpty();
        assertThat(assets).allSatisfy(path -> {
            Map<String, String> headers = get(path);
            assertThat(headers).as("GET %s may be kept unchanged for a year", path)
                    .containsEntry("cache-control", IMMUTABLE)
                    .doesNotContainKeys("pragma", "expires");
            assertThat(headers).as("GET %s keeps the application's security headers", path)
                    .containsAllEntriesOf(ApplicationResponseHeaders.SECURITY);
        });
    }

    @Test
    void whenTheShellTheServiceWorkerOrAnApiReadIsRequested_thenNoBrowserKeepsIt() {
        // given
        List<String> paths = List.of("/", "/index.html", "/my-bookings", "/sw.js", "/workbox-probe.js",
                "/api/public/config", "/api/session");

        // when / then
        assertThat(paths).allSatisfy(path -> assertThat(get(path))
                .as("GET %s is fetched again on every load", path)
                .containsAllEntriesOf(ApplicationResponseHeaders.UNCACHED));
    }

    private Map<String, String> get(String path) {
        try {
            HttpResponse<Void> response = anonymous.send(
                    HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).GET().build(),
                    HttpResponse.BodyHandlers.discarding());
            assertThat(response.statusCode()).as("GET %s is served", path).isEqualTo(200);
            return ApplicationResponseHeaders.comparable(response.headers());
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exception);
        }
    }
}
