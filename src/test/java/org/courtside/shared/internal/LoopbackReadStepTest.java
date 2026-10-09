package org.courtside.shared.internal;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.courtside.shared.ServerTlsProperties;
import org.junit.jupiter.api.Test;
import org.springframework.boot.web.server.WebServer;
import org.springframework.boot.web.server.context.WebServerApplicationContext;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ProxySelector;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class LoopbackReadStepTest {

    private static final String REFUSED = "/api/public/refused";
    private static final String DENIED = "/api/denied";
    private static final ServerTlsProperties PLAINTEXT =
            new ServerTlsProperties(ServerTlsProperties.Mode.PLAINTEXT, null, null);
    private static final ServerTlsProperties SERVE =
            new ServerTlsProperties(ServerTlsProperties.Mode.SERVE, null, null);

    private final List<String> requested = new CopyOnWriteArrayList<>();
    private HttpServer server;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            requested.add(exchange.getRequestURI().toString());
            String path = exchange.getRequestURI().getPath();
            int status = path.equals(REFUSED) ? 429 : path.equals(DENIED) ? 401 : 200;
            byte[] body = (status == 429 ? "{\"type\":\"urn:courtside:error:request-rate-limited\"}"
                    : status == 401 ? "{\"type\":\"urn:courtside:error:authentication-required\"}" : "{}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, body.length);
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
        LoopbackReadStep step = new LoopbackReadStep("public-reads",
                () -> List.of("/api/public/config", "/api/bookings?date=2026-05-12"), instance(), PLAINTEXT);

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
        LoopbackReadStep step = new LoopbackReadStep("public-reads", () -> List.of("/api/public/config"),
                instance(), SERVE);

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
        LoopbackReadStep step = new LoopbackReadStep("public-reads", () -> List.of(DENIED),
                instance(), PLAINTEXT);

        // when / then
        assertThatThrownBy(step::run)
                .as("a refused read must be diagnosable from its path, status and problem type")
                .isInstanceOf(WarmUpRequestRefusedException.class)
                .hasMessageContaining(DENIED)
                .hasMessageContaining("401")
                .hasMessageContaining("urn:courtside:error:authentication-required");
    }

    @Test
    void givenTheLoopbackBudgetIsSpent_whenTheStepRuns_thenItStopsReadingWithoutAFailure() throws Exception {
        // given
        LoopbackReadStep step = new LoopbackReadStep("public-reads",
                () -> List.of(REFUSED, "/api/public/config"), instance(), PLAINTEXT);

        // when
        boolean exercised = step.run();

        // then
        assertThat(exercised)
                .as("a spent request budget ends the reads instead of failing the warm-up")
                .isFalse();
        assertThat(requested)
                .as("no read may follow the refusal that spent the budget")
                .containsExactly(REFUSED);
    }

    @Test
    void givenADefaultProxySelector_whenTheStepRuns_thenItStillReachesTheInstanceDirectly() throws Exception {
        // given
        ProxySelector original = ProxySelector.getDefault();
        ProxySelector.setDefault(ProxySelector.of(new InetSocketAddress("127.0.0.1", 9)));
        LoopbackReadStep step = new LoopbackReadStep("public-reads", () -> List.of("/api/public/config"),
                instance(), PLAINTEXT);

        // when
        boolean exercised;
        try {
            exercised = step.run();
        } finally {
            ProxySelector.setDefault(original);
        }

        // then
        assertThat(exercised)
                .as("a proxy the platform configures must not stand between the instance and itself")
                .isTrue();
        assertThat(requested)
                .as("the read must arrive at the instance, not at a proxy")
                .containsExactly("/api/public/config");
    }

    private WebServerApplicationContext instance() {
        WebServer webServer = mock(WebServer.class);
        when(webServer.getPort()).thenReturn(server.getAddress().getPort());
        WebServerApplicationContext context = mock(WebServerApplicationContext.class);
        when(context.getWebServer()).thenReturn(webServer);
        return context;
    }
}
