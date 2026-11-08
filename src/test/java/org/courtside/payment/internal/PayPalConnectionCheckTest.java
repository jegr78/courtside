package org.courtside.payment.internal;

import com.sun.net.httpserver.HttpServer;
import org.courtside.payment.PayPalEnvironment;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;

import static org.assertj.core.api.Assertions.assertThat;

class PayPalConnectionCheckTest {

    private HttpServer server;

    @AfterEach
    void stop() {
        if (server != null) server.stop(0);
    }

    @Test
    void givenAProviderThatNeverAnswers_whenChecking_thenTheCheckGivesUpAsUnreachable() throws IOException {
        // given
        URI endpoint = serve(200, "{}", Duration.ofSeconds(5));
        PayPalConnectionCheck check = connectionCheck(
                new PayPalProperties(endpoint, endpoint, Duration.ofMillis(300)));

        // when
        PayPalConnectionCheck.Result result = check.check(PayPalEnvironment.SANDBOX, "client", "secret");

        // then
        assertThat(result.outcome()).isEqualTo(PayPalConnectionCheck.Outcome.UNREACHABLE);
        assertThat(result.providerReason()).isNull();
    }

    @Test
    void givenNoListener_whenChecking_thenTheHostIsUnreachable() throws IOException {
        // given
        int port;
        try (ServerSocket socket = new ServerSocket(0)) {
            port = socket.getLocalPort();
        }
        URI closed = URI.create("http://127.0.0.1:" + port);
        PayPalConnectionCheck check = connectionCheck(new PayPalProperties(closed, closed, Duration.ofSeconds(2)));

        // when / then
        assertThat(check.check(PayPalEnvironment.LIVE, "client", "secret").outcome())
                .isEqualTo(PayPalConnectionCheck.Outcome.UNREACHABLE);
    }

    @Test
    void givenAnUnstructuredRefusal_whenChecking_thenTheStatusIsTheReasonAndTheBodyIsNotRepeated() throws IOException {
        // given
        URI endpoint = serve(503, "<html>\u001b[31mmaintenance " + "x".repeat(500) + "</html>", Duration.ZERO);
        PayPalConnectionCheck check = connectionCheck(
                new PayPalProperties(endpoint, endpoint, Duration.ofSeconds(2)));

        // when
        PayPalConnectionCheck.Result result = check.check(PayPalEnvironment.SANDBOX, "client", "secret");

        // then
        assertThat(result.outcome()).isEqualTo(PayPalConnectionCheck.Outcome.REJECTED);
        assertThat(result.providerReason()).isEqualTo("HTTP 503");
    }

    @Test
    void givenAnOverlongProviderDescription_whenChecking_thenTheReasonIsBoundedAndPrintable() throws IOException {
        // given
        URI endpoint = serve(400, "{\"error\":\"invalid_request\",\"error_description\":\"bad\\u0007 " + "y".repeat(500)
                + "\"}", Duration.ZERO);
        PayPalConnectionCheck check = connectionCheck(
                new PayPalProperties(endpoint, endpoint, Duration.ofSeconds(2)));

        // when
        String reason = check.check(PayPalEnvironment.SANDBOX, "client", "secret").providerReason();

        // then
        assertThat(reason).startsWith("invalid_request: bad ").hasSizeLessThanOrEqualTo(PayPalConnectionCheck.MAX_REASON);
        assertThat(reason.chars()).as("no control character reaches the screen").noneMatch(Character::isISOControl);
    }

    @Test
    void givenARedirect_whenChecking_thenItIsNotFollowedAndTheCredentialsGoNowhereElse() throws IOException {
        // given
        List<String> paths = new CopyOnWriteArrayList<>();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            paths.add(exchange.getRequestURI().getPath());
            exchange.getResponseHeaders().add("Location", "/elsewhere");
            exchange.sendResponseHeaders(302, -1);
            exchange.close();
        });
        server.start();
        URI endpoint = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
        PayPalConnectionCheck check = connectionCheck(
                new PayPalProperties(endpoint, endpoint, Duration.ofSeconds(2)));

        // when
        PayPalConnectionCheck.Result result = check.check(PayPalEnvironment.SANDBOX, "client", "secret");

        // then
        assertThat(result.outcome()).isEqualTo(PayPalConnectionCheck.Outcome.REJECTED);
        assertThat(result.providerReason()).isEqualTo("HTTP 302");
        assertThat(paths).as("only the token endpoint ever sees the credentials").containsExactly("/v1/oauth2/token");
    }

    private static PayPalConnectionCheck connectionCheck(PayPalProperties properties) {
        return new PayPalConnectionCheck(new PayPalClient(properties));
    }

    private URI serve(int status, String body, Duration delay) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            try {
                Thread.sleep(delay.toMillis());
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            byte[] answer = body.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, answer.length == 0 ? -1 : answer.length);
            if (answer.length > 0) exchange.getResponseBody().write(answer);
            exchange.close();
        });
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();
        return URI.create("http://127.0.0.1:" + server.getAddress().getPort());
    }
}
