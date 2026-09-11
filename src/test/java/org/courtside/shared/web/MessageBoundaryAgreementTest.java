package org.courtside.shared.web;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.testcontainers.Testcontainers;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.DockerImageName;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.testcontainers.images.builder.Transferable.of;

// The deployment terminates the request and frames a new one for the application, so the two hops
// are two parsers reading the same bytes. What they may not do is leave a second request behind.
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class MessageBoundaryAgreementTest extends AbstractIntegrationTest {

    private static final String HOST = "courtside.test";
    private static final String UPSTREAM = "host.testcontainers.internal";
    private static final int FORWARDED_PORT = 8090;
    private static final Pattern CADDY_IMAGE =
            Pattern.compile("caddy:[\\w.-]+@sha256:[a-f0-9]{64}");
    private static final Pattern STATUS_LINE = Pattern.compile("(?m)^HTTP/1\\.[01] (\\d{3})");
    private static final Pattern FIELD = Pattern.compile("(?m)^([A-Za-z-]+):[ \\t]*(.*)\\r?$");

    private enum Reading { PROXY_REFUSED, CONNECTOR_REFUSED, APPLICATION_ANSWERED }

    private record Answer(int responses, int status, Reading reading) {
    }

    private record Hop(int status, Reading reading) {
    }

    private record Framing(String request, Hop direct, Hop throughTheDeployment) {
    }

    private static Hop refusedByTheConnector(int status) {
        return new Hop(status, Reading.CONNECTOR_REFUSED);
    }

    private static Hop refusedByTheProxy(int status) {
        return new Hop(status, Reading.PROXY_REFUSED);
    }

    private static Hop answered(int status) {
        return new Hop(status, Reading.APPLICATION_ANSWERED);
    }

    private static final Map<String, Framing> CORPUS = new LinkedHashMap<>(Map.ofEntries(
            Map.entry("two lengths that agree", new Framing(
                    body("Content-Length: 5\r\nContent-Length: 5", "ab=cd"),
                    refusedByTheConnector(400), answered(403))),
            Map.entry("two lengths that disagree", new Framing(
                    body("Content-Length: 5\r\nContent-Length: 6", "ab=cd"),
                    refusedByTheConnector(400), refusedByTheProxy(400))),
            Map.entry("a length beside a chunked body", new Framing(
                    body("Content-Length: 53\r\nTransfer-Encoding: chunked",
                            "0\r\n\r\nGET /api/public/config HTTP/1.1\r\nHost: %s\r\n\r\n"),
                    answered(403), answered(403))),
            Map.entry("a chunked body named twice", new Framing(
                    body("Transfer-Encoding: chunked\r\nTransfer-Encoding: chunked", "0\r\n\r\n"),
                    refusedByTheConnector(400), refusedByTheProxy(501))),
            Map.entry("a chunked body named with a companion", new Framing(
                    body("Transfer-Encoding: identity, chunked", "0\r\n\r\n"),
                    refusedByTheConnector(501), refusedByTheProxy(501))),
            Map.entry("an encoding no hop implements", new Framing(
                    body("Transfer-Encoding: cow\r\nContent-Length: 0", ""),
                    refusedByTheConnector(501), refusedByTheProxy(501))),
            Map.entry("a chunked body whose name carries a leading space", new Framing(
                    body("Transfer-Encoding:  chunked", "0\r\n\r\n"),
                    answered(403), answered(403))),
            Map.entry("a chunk size that is not a number", new Framing(
                    body("Transfer-Encoding: chunked", "zz\r\n\r\n"),
                    refusedByTheConnector(400), refusedByTheProxy(502))),
            Map.entry("a request line ended by a bare newline", new Framing(
                    "GET /api/public/config HTTP/1.1\nHost: %s\n\n",
                    answered(200), answered(200))),
            Map.entry("a carriage return inside a header value", new Framing(
                    aRead("X-Thing: a\rb"), refusedByTheConnector(400), refusedByTheProxy(400))),
            Map.entry("a second host", new Framing(
                    aRead("Host: other.example"), refusedByTheConnector(400), refusedByTheProxy(400))),
            Map.entry("a space before a header colon", new Framing(
                    aRead("X-Thing : a"), refusedByTheConnector(400), refusedByTheProxy(400))),
            Map.entry("a length on a body-free read", new Framing(
                    aRead("Content-Length: 5") + "ab=cd", answered(200), answered(200))),
            Map.entry("nothing ambiguous at all", new Framing(
                    aRead(null), answered(200), answered(200)))));

    private static String aRead(String field) {
        return "GET /api/public/config HTTP/1.1\r\nHost: %s\r\n"
                + (field == null ? "" : field + "\r\n") + "\r\n";
    }

    private static String body(String framing, String content) {
        return "POST /api/session HTTP/1.1\r\nHost: %s\r\n"
                + "Content-Type: application/x-www-form-urlencoded\r\n" + framing + "\r\n\r\n"
                + content;
    }

    private static GenericContainer<?> proxy;

    @LocalServerPort
    private int port;

    @AfterAll
    static void stopTheProxy() {
        if (proxy != null) {
            proxy.stop();
        }
    }

    // One request in, one response out, whatever the framing says -- the boundary the second
    // request of a smuggled pair would need is the one that never opens.
    @Test
    void givenAnAmbiguouslyFramedMessage_whenBothHopsReadIt_thenNeitherAnswersTwice()
            throws Exception {
        // when / then
        for (Map.Entry<String, Framing> entry : CORPUS.entrySet()) {
            assertThat(directly(entry.getValue()).responses())
                    .as("%s, read by the connector", entry.getKey()).isEqualTo(1);
            assertThat(throughTheDeployment(entry.getValue()).responses())
                    .as("%s, read through the deployment", entry.getKey()).isEqualTo(1);
        }
    }

    @Test
    void givenAnAmbiguouslyFramedMessage_whenBothHopsReadIt_thenEachAnswersWhatTheInventoryRecords()
            throws Exception {
        // when / then
        for (Map.Entry<String, Framing> entry : CORPUS.entrySet()) {
            Framing framing = entry.getValue();
            assertThat(hop(directly(framing)))
                    .as("%s, read by the connector", entry.getKey()).isEqualTo(framing.direct());
            assertThat(hop(throughTheDeployment(framing)))
                    .as("%s, read through the deployment", entry.getKey())
                    .isEqualTo(framing.throughTheDeployment());
        }
    }

    // Where the deployment admits a message the connector alone refuses, the field it repeats has
    // to carry one value, because a message with one possible boundary has nothing to disagree on.
    @Test
    void givenTheDeploymentAdmitsWhatTheConnectorRefuses_thenTheRepeatedFieldsStateOneBoundary() {
        // given
        List<String> widened = CORPUS.entrySet().stream()
                .filter(entry -> entry.getValue().direct().reading() == Reading.CONNECTOR_REFUSED)
                .filter(entry -> entry.getValue().throughTheDeployment().reading()
                        == Reading.APPLICATION_ANSWERED)
                .map(Map.Entry::getKey)
                .toList();

        // when / then
        assertThat(widened).isNotEmpty();
        for (String label : widened) {
            assertThat(repeatedFieldsThatDisagree(CORPUS.get(label).request()))
                    .as("%s, admitted by the deployment", label).isEmpty();
        }
    }

    private static List<String> repeatedFieldsThatDisagree(String request) {
        Map<String, String> seen = new LinkedHashMap<>();
        List<String> disagreeing = new ArrayList<>();
        Matcher fields = FIELD.matcher(request.substring(request.indexOf("\r\n") + 2));
        while (fields.find()) {
            String name = fields.group(1).toLowerCase(Locale.ROOT);
            String value = fields.group(2).strip();
            if (seen.containsKey(name) && !seen.get(name).equals(value)) {
                disagreeing.add(name);
            }
            seen.putIfAbsent(name, value);
        }
        return disagreeing;
    }

    private static Hop hop(Answer answer) {
        return new Hop(answer.status(), answer.reading());
    }

    private Answer directly(Framing framing) throws IOException {
        return send("127.0.0.1", port, framing.request().formatted("localhost", "localhost"));
    }

    private Answer throughTheDeployment(Framing framing) throws IOException {
        return send(proxy().getHost(), proxy().getMappedPort(80),
                framing.request().formatted(HOST, HOST));
    }

    private static Answer send(String host, int port, String request) throws IOException {
        try (Socket socket = new Socket(host, port)) {
            socket.setSoTimeout(3000);
            OutputStream out = socket.getOutputStream();
            out.write(request.getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
            return read(socket.getInputStream());
        }
    }

    private static Answer read(InputStream in) throws IOException {
        StringBuilder answer = new StringBuilder();
        byte[] buffer = new byte[4096];
        try {
            for (int count = in.read(buffer); count >= 0; count = in.read(buffer)) {
                answer.append(new String(buffer, 0, count, StandardCharsets.ISO_8859_1));
            }
        } catch (SocketTimeoutException stillOpen) {
            // A hop that keeps the connection open has said everything it means to say.
        }
        Matcher statusLines = STATUS_LINE.matcher(answer);
        int responses = 0;
        int first = 0;
        while (statusLines.find()) {
            first = responses == 0 ? Integer.parseInt(statusLines.group(1)) : first;
            responses++;
        }
        return new Answer(responses, first, reading(answer.toString()));
    }

    private static Reading reading(String answer) {
        if (answer.contains("clubName")) {
            return Reading.APPLICATION_ANSWERED;
        }
        if (!answer.contains("urn:courtside:")) {
            return Reading.PROXY_REFUSED;
        }
        return answer.contains("urn:courtside:error:request-rejected")
                || answer.contains("urn:courtside:error:not-implemented")
                ? Reading.CONNECTOR_REFUSED
                : Reading.APPLICATION_ANSWERED;
    }

    private GenericContainer<?> proxy() throws IOException {
        if (proxy == null) {
            Testcontainers.exposeHostPorts(Map.of(port, FORWARDED_PORT));
            proxy = new GenericContainer<>(DockerImageName.parse(deployedCaddy()))
                    .withCopyToContainer(of(theDeploymentsFrontDoor()), "/etc/caddy/Caddyfile")
                    .withExposedPorts(80)
                    .waitingFor(Wait.forLogMessage(".*serving initial configuration.*", 1));
            proxy.start();
        }
        return proxy;
    }

    // Only the upstream address and the site's transport are substituted: the body limit, the
    // header rewriting and the error handling are the deployment's own text.
    private static String theDeploymentsFrontDoor() throws IOException {
        return "%s\n\n%s\n\n%s\n".formatted(
                block("(applicationHeaders) {"),
                replacingOnce(block("(plaintext) {"), "app:8080", UPSTREAM + ":" + FORWARDED_PORT),
                replacingOnce(replacingOnce(block("{$COURTSIDE_DOMAIN} {"),
                        "{$COURTSIDE_DOMAIN}", "http://" + HOST),
                        "import {$COURTSIDE_APP_TLS_MODE:plaintext}", "import plaintext"));
    }

    private static String replacingOnce(String text, String what, String with) {
        assertThat(text.split(Pattern.quote(what), -1).length - 1)
                .as("the deployment states %s exactly once", what).isEqualTo(1);
        return text.replace(what, with);
    }

    private static String block(String marker) throws IOException {
        String caddyfile = Files.readString(Path.of("deploy", "Caddyfile"));
        int start = caddyfile.indexOf(marker);
        assertThat(start).as("the deployment defines %s", marker).isNotNegative();
        int depth = 0;
        for (int cursor = caddyfile.indexOf('{', start + marker.length() - 1);
                cursor < caddyfile.length(); cursor++) {
            char character = caddyfile.charAt(cursor);
            depth += character == '{' ? 1 : character == '}' ? -1 : 0;
            if (depth == 0 && character == '}') {
                return caddyfile.substring(start, cursor + 1);
            }
        }
        throw new AssertionError("The " + marker + " block is not closed");
    }

    private static String deployedCaddy() throws IOException {
        Matcher image = CADDY_IMAGE.matcher(Files.readString(Path.of("deploy", "compose.yaml")));
        assertThat(image.find()).as("the deployment pins a Caddy image").isTrue();
        return image.group();
    }
}
