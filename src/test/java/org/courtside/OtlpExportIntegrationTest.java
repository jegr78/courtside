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
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.GZIPInputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "management.opentelemetry.tracing.export.schedule-delay=100ms",
        "management.opentelemetry.tracing.export.otlp.connect-timeout=100ms",
        "management.opentelemetry.tracing.export.otlp.timeout=200ms",
        "management.otlp.metrics.export.step=1s",
        "management.otlp.metrics.export.connect-timeout=100ms",
        "management.otlp.metrics.export.read-timeout=200ms",
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

    @Test
    void givenTheCollectorRefusesExport_whenTheApplicationHandlesARequest_thenTheRequestStillSucceeds()
            throws Exception {
        // given
        int refusalsBefore = COLLECTOR.refusalResponses();
        COLLECTOR.respondWith(503);

        try {
            // when
            meters.counter("courtside.export.refusal.test").increment();
            HttpResponse<Void> response = HttpClient.newHttpClient().send(
                    HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + applicationPort
                            + "/api/public/courts?export-refusal=true")).build(),
                    HttpResponse.BodyHandlers.discarding());

            // then
            assertThat(response.statusCode()).isEqualTo(200);
            await().atMost(Duration.ofSeconds(5)).untilAsserted(() ->
                    assertThat(COLLECTOR.refusalResponses()).isGreaterThan(refusalsBefore));
        } finally {
            COLLECTOR.respondWith(200);
        }
    }

    @Test
    void givenTheCollectorStalls_whenTheApplicationHandlesARequest_thenTheRequestStillSucceeds()
            throws Exception {
        // given
        int stalledBefore = COLLECTOR.stalledResponses();
        CountDownLatch stalledResponse = COLLECTOR.stallNextResponse("/v1/traces");

        try {
            // when
            meters.counter("courtside.export.timeout.test").increment();
            HttpResponse<Void> response = request("export-timeout");

            // then
            assertThat(response.statusCode()).isEqualTo(200);
            await().atMost(Duration.ofSeconds(5)).untilAsserted(() ->
                    assertThat(COLLECTOR.stalledResponses()).isGreaterThan(stalledBefore));
            int successesAfterStall = COLLECTOR.successfulResponses("/v1/traces");
            assertThat(request("export-after-timeout").statusCode()).isEqualTo(200);
            await().atMost(Duration.ofSeconds(5)).untilAsserted(() ->
                    assertThat(COLLECTOR.successfulResponses("/v1/traces"))
                            .isGreaterThan(successesAfterStall));
        } finally {
            stalledResponse.countDown();
        }
    }

    private HttpResponse<Void> request(String probe) throws IOException, InterruptedException {
        return HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + applicationPort
                        + "/api/public/courts?" + probe + "=true")).build(),
                HttpResponse.BodyHandlers.discarding());
    }

    private static final class Collector {

        private final HttpServer server;
        private final List<String> paths = new CopyOnWriteArrayList<>();
        private final List<String> authorizations = new CopyOnWriteArrayList<>();
        private final List<byte[]> payloads = new CopyOnWriteArrayList<>();
        private final AtomicInteger responseStatus = new AtomicInteger(200);
        private final AtomicInteger refusalResponses = new AtomicInteger();
        private final AtomicInteger stalledResponses = new AtomicInteger();
        private final AtomicReference<String> stalledPath = new AtomicReference<>();
        private final AtomicReference<CountDownLatch> responseGate =
                new AtomicReference<>(new CountDownLatch(0));
        private final Map<String, AtomicInteger> successfulResponses = new ConcurrentHashMap<>();

        private Collector(HttpServer server) {
            this.server = server;
        }

        static Collector start() {
            try {
                HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
                Collector collector = new Collector(server);
                server.createContext("/", collector::receive);
                server.setExecutor(Executors.newCachedThreadPool(runnable -> {
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

        void respondWith(int status) {
            responseStatus.set(status);
        }

        int refusalResponses() {
            return refusalResponses.get();
        }

        CountDownLatch stallNextResponse(String path) {
            CountDownLatch gate = new CountDownLatch(1);
            stalledPath.set(path);
            responseGate.set(gate);
            return gate;
        }

        int stalledResponses() {
            return stalledResponses.get();
        }

        int successfulResponses(String path) {
            return successfulResponses.getOrDefault(path, new AtomicInteger()).get();
        }

        private void receive(HttpExchange exchange) throws IOException {
            paths.add(exchange.getRequestURI().getPath());
            authorizations.add(exchange.getRequestHeaders().getFirst("Authorization"));
            byte[] body = exchange.getRequestBody().readAllBytes();
            if ("gzip".equalsIgnoreCase(exchange.getRequestHeaders().getFirst("Content-Encoding"))) {
                body = new GZIPInputStream(new java.io.ByteArrayInputStream(body)).readAllBytes();
            }
            payloads.add(body);
            CountDownLatch gate = responseGate.get();
            if (exchange.getRequestURI().getPath().equals(stalledPath.get())
                    && gate.getCount() > 0
                    && responseGate.compareAndSet(gate, new CountDownLatch(0))) {
                stalledResponses.incrementAndGet();
                try {
                    gate.await();
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    throw new IOException("Interrupted collector delay", exception);
                }
            }
            int status = responseStatus.get();
            exchange.sendResponseHeaders(status, -1);
            if (status >= 200 && status < 300) {
                successfulResponses.computeIfAbsent(exchange.getRequestURI().getPath(),
                        ignored -> new AtomicInteger()).incrementAndGet();
            }
            if (status == 503) {
                refusalResponses.incrementAndGet();
            }
            exchange.close();
        }
    }
}
