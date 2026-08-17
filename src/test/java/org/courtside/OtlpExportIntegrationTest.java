package org.courtside;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.micrometer.core.instrument.MeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.zip.GZIPInputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "management.opentelemetry.tracing.export.schedule-delay=100ms",
        "management.otlp.metrics.export.step=1s",
        "management.tracing.sampling.probability=1.0"
})
class OtlpExportIntegrationTest extends AbstractIntegrationTest {

    private static final Collector COLLECTOR = Collector.start();
    private static final String PRIVATE_MARKER = "JaneDoePrivateMarker";

    @LocalServerPort
    private int applicationPort;

    @Autowired
    private MeterRegistry meters;

    @DynamicPropertySource
    static void configureCollector(DynamicPropertyRegistry properties) {
        properties.add("management.tracing.export.otlp.enabled", () -> true);
        properties.add("management.otlp.metrics.export.enabled", () -> true);
        properties.add("management.opentelemetry.tracing.export.otlp.endpoint",
                () -> COLLECTOR.endpoint("/v1/traces"));
        properties.add("management.otlp.metrics.export.url", () -> COLLECTOR.endpoint("/v1/metrics"));
        properties.add("management.opentelemetry.tracing.export.otlp.headers.Authorization",
                () -> "Bearer test-token");
        properties.add("management.otlp.metrics.export.headers.Authorization", () -> "Bearer test-token");
    }

    @Test
    void givenAnHttpRequestAndDomainMetric_whenExportRuns_thenBothSignalsReachTheAuthenticatedCollector()
            throws Exception {
        // given
        meters.counter("courtside.export.test").increment();

        // when
        HttpResponse<Void> response = HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + applicationPort
                        + "/api/public/courts?probe=" + PRIVATE_MARKER)).build(),
                HttpResponse.BodyHandlers.discarding());

        // then
        assertThat(response.statusCode()).isEqualTo(200);
        await().atMost(Duration.ofSeconds(5)).untilAsserted(() ->
                assertThat(COLLECTOR.paths()).contains("/v1/traces", "/v1/metrics"));
        assertThat(COLLECTOR.authorizations()).containsOnly("Bearer test-token");
        assertThat(COLLECTOR.payloadText()).doesNotContain(PRIVATE_MARKER);
    }

    private static final class Collector {

        private final HttpServer server;
        private final List<String> paths = new CopyOnWriteArrayList<>();
        private final List<String> authorizations = new CopyOnWriteArrayList<>();
        private final List<byte[]> payloads = new CopyOnWriteArrayList<>();

        private Collector(HttpServer server) {
            this.server = server;
        }

        static Collector start() {
            try {
                HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
                Collector collector = new Collector(server);
                server.createContext("/", collector::receive);
                server.setExecutor(Executors.newSingleThreadExecutor(runnable -> {
                    Thread thread = new Thread(runnable, "test-otlp-collector");
                    thread.setDaemon(true);
                    return thread;
                }));
                server.start();
                return collector;
            } catch (IOException exception) {
                throw new IllegalStateException("Cannot start the test OTLP collector", exception);
            }
        }

        String endpoint(String path) {
            return "http://127.0.0.1:" + server.getAddress().getPort() + path;
        }

        List<String> paths() {
            return List.copyOf(paths);
        }

        List<String> authorizations() {
            return List.copyOf(authorizations);
        }

        String payloadText() {
            return payloads.stream()
                    .map(bytes -> new String(bytes, StandardCharsets.ISO_8859_1))
                    .reduce("", String::concat);
        }

        private void receive(HttpExchange exchange) throws IOException {
            paths.add(exchange.getRequestURI().getPath());
            authorizations.add(exchange.getRequestHeaders().getFirst("Authorization"));
            byte[] body = exchange.getRequestBody().readAllBytes();
            if ("gzip".equalsIgnoreCase(exchange.getRequestHeaders().getFirst("Content-Encoding"))) {
                body = new GZIPInputStream(new java.io.ByteArrayInputStream(body)).readAllBytes();
            }
            payloads.add(body);
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        }
    }
}
