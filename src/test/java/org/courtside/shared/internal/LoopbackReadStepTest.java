package org.courtside.shared.internal;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.web.server.WebServer;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.mock.env.MockEnvironment;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class LoopbackReadStepTest {

    private static final String REFUSED = "/api/public/refused";

    private final List<String> requested = new CopyOnWriteArrayList<>();
    private HttpServer server;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            requested.add(exchange.getRequestURI().toString());
            boolean refused = exchange.getRequestURI().getPath().equals(REFUSED);
            byte[] body = (refused ? "{\"type\":\"urn:courtside:error:request-rate-limited\"}" : "{}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(refused ? 429 : 200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    @Test
    void givenAPlaintextInstance_whenTheStepRuns_thenItReadsEveryPathOverTheLoopbackAddress() throws Exception {
        // given
        LoopbackReadStep step = new LoopbackReadStep("public-reads", instance("plaintext"),
                () -> List.of("/api/public/config", "/api/bookings?date=2026-05-12"));

        // when
        boolean exercised = step.run();

        // then
        assertThat(exercised)
                .as("a plaintext instance must have its reads exercised")
                .isTrue();
        assertThat(requested)
                .as("every path must reach the instance's own port")
                .containsExactly("/api/public/config", "/api/bookings?date=2026-05-12");
    }

    @Test
    void givenAnInstanceServingTls_whenTheStepRuns_thenItSkipsWithoutARequest() throws Exception {
        // given
        LoopbackReadStep step = new LoopbackReadStep("public-reads", instance("serve"),
                () -> List.of("/api/public/config"));

        // when
        boolean exercised = step.run();

        // then
        assertThat(exercised)
                .as("a certificate that names the club's host cannot be verified over the loopback address")
                .isFalse();
        assertThat(requested)
                .as("a skipped step must not send a request")
                .isEmpty();
    }

    @Test
    void givenARefusedRead_whenTheStepRuns_thenTheFailureNamesThePathStatusAndProblemType() {
        // given
        LoopbackReadStep step = new LoopbackReadStep("public-reads", instance("plaintext"),
                () -> List.of(REFUSED));

        // when / then
        assertThatThrownBy(step::run)
                .as("a refused read must be diagnosable from its path, status and problem type")
                .isInstanceOf(WarmUpRequestRefusedException.class)
                .hasMessageContaining(REFUSED)
                .hasMessageContaining("429")
                .hasMessageContaining("urn:courtside:error:request-rate-limited");
    }

    private WebServerApplicationContext instance(String tlsMode) {
        WebServer webServer = mock(WebServer.class);
        when(webServer.getPort()).thenReturn(server.getAddress().getPort());
        WebServerApplicationContext context = mock(WebServerApplicationContext.class);
        when(context.getWebServer()).thenReturn(webServer);
        when(context.getEnvironment()).thenReturn(
                new MockEnvironment().withProperty("courtside.server.tls.mode", tlsMode));
        return context;
    }
}
