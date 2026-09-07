package org.courtside.shared;

import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.courtside.TestCertificate;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.tomcat.servlet.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServer;
import org.testcontainers.Testcontainers;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class ServerTlsTransportTest {

    private static final String MARKER = "the-application-answered";
    private static final String UPSTREAM = "host.testcontainers.internal";
    private static final int SERVED_PORT = 8080;
    private static final int PLAIN_PORT = 8081;
    private static final String AUTHORITY = "/etc/courtside/tls/app-authority/authority.pem";
    private static final Pattern CADDY_IMAGE =
            Pattern.compile("caddy:[\\w.-]+@sha256:[a-f0-9]{64}");

    private static TestCertificate served;
    private static WebServer application;
    private static WebServer plainApplication;

    // A forwarding is registered for the whole JVM, so each of the two applications is reached
    // through a port of its own rather than through one the second run would be refused.
    @BeforeAll
    static void startTheApplications() throws Exception {
        served = TestCertificate.issuedFor(UPSTREAM);
        application = serving(new ServerTlsProperties(ServerTlsProperties.Mode.SERVE,
                written(served.certificate()), written(served.key())));
        plainApplication = serving(
                new ServerTlsProperties(ServerTlsProperties.Mode.PLAINTEXT, null, null));
        Testcontainers.exposeHostPorts(Map.of(application.getPort(), SERVED_PORT,
                plainApplication.getPort(), PLAIN_PORT));
    }

    @AfterAll
    static void stopTheApplications() {
        application.stop();
        plainApplication.stop();
    }

    // The deployment's own line decides which snippet is imported, and a club that sets nothing
    // gets the default in it -- so the switch and its default are read rather than assumed.
    @Test
    void givenNoModeIsSet_whenTheProxyDialsTheApplication_thenItReachesItInPlainText()
            throws Exception {
        // given
        TestCertificate foreign = TestCertificate.issuedFor(UPSTREAM);

        // when
        try (GenericContainer<?> proxy = proxy(foreign.authority(), null)) {
            HttpResponse<String> answer = get(proxy);

            // then
            assertThat(answer.statusCode()).isEqualTo(200);
            assertThat(answer.body()).isEqualTo(MARKER);
        }
    }

    @Test
    void givenTheAuthorityThatIssuedIt_whenTheProxyDialsTheApplication_thenItAnswers()
            throws Exception {
        // when
        try (GenericContainer<?> proxy = proxy(served.authority(), "serve")) {
            HttpResponse<String> answer = get(proxy);

            // then
            assertThat(answer.statusCode()).isEqualTo(200);
            assertThat(answer.body()).isEqualTo(MARKER);
        }
    }

    // A proxy that fell back to plaintext when it could not verify the application would answer
    // exactly as the case above does, which is why the answer is read rather than the status alone.
    @Test
    void givenAnAuthorityThatDoesNotVouch_whenTheProxyDialsTheApplication_thenItRefuses()
            throws Exception {
        // given
        TestCertificate foreign = TestCertificate.issuedFor(UPSTREAM);

        // when
        try (GenericContainer<?> proxy = proxy(foreign.authority(), "serve")) {
            HttpResponse<String> answer = get(proxy);

            // then
            assertThat(answer.statusCode()).isEqualTo(502);
            assertThat(answer.body()).doesNotContain(MARKER);
            assertThat(proxy.getLogs()).contains("x509").contains("unknown authority");
        }
    }

    private static WebServer serving(ServerTlsProperties tls) {
        TomcatServletWebServerFactory factory = new TomcatServletWebServerFactory(0);
        ServerTls.apply(factory, tls);
        WebServer server = factory.getWebServer(servlet -> servlet
                .addServlet("probe", new HttpServlet() {
                    @Override
                    protected void doGet(HttpServletRequest request, HttpServletResponse response)
                            throws IOException {
                        response.getWriter().write(MARKER);
                    }
                }).addMapping("/probe"));
        server.start();
        return server;
    }

    // The proxy dials the name the deployment's own snippet names, so only the host it resolves to
    // is substituted -- the transport, the anchor's path and the headers are the deployment's text.
    private static GenericContainer<?> proxy(String authority, String mode) throws IOException {
        String caddyfile = """
                {
                	auto_https off
                }

                %s

                %s

                %s

                http://:80 {
                	%s
                }
                """.formatted(snippet("applicationHeaders"), dialingTheHost("plaintext", PLAIN_PORT),
                dialingTheHost("serve", SERVED_PORT), theDeploymentsSwitch());
        GenericContainer<?> proxy = new GenericContainer<>(DockerImageName.parse(deployedCaddy()))
                .withCopyToContainer(forString(caddyfile), "/etc/caddy/Caddyfile")
                .withCopyToContainer(forString(authority), AUTHORITY)
                .withExposedPorts(80)
                .waitingFor(Wait.forLogMessage(".*serving initial configuration.*", 1));
        if (mode != null) {
            proxy.withEnv("COURTSIDE_APP_TLS_MODE", mode);
        }
        proxy.start();
        return proxy;
    }

    // The upstream is the only token substituted: the transport, the anchor's path, the headers and
    // the line that chooses between the two are the deployment's own text.
    private static String dialingTheHost(String name, int port) throws IOException {
        return snippet(name).replace("app:8080", UPSTREAM + ":" + port);
    }

    private static String theDeploymentsSwitch() throws IOException {
        return Files.readString(Path.of("deploy", "Caddyfile")).lines()
                .map(String::strip)
                .filter(line -> line.startsWith("import {$COURTSIDE_APP_TLS_MODE"))
                .findFirst()
                .orElseThrow(() -> new AssertionError("The deployment names no application mode"));
    }

    private static HttpResponse<String> get(GenericContainer<?> proxy) throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            return client.send(HttpRequest.newBuilder(URI.create("http://" + proxy.getHost() + ":"
                    + proxy.getMappedPort(80) + "/probe")).build(), HttpResponse.BodyHandlers.ofString());
        }
    }

    private static String snippet(String name) throws IOException {
        String caddyfile = Files.readString(Path.of("deploy", "Caddyfile"));
        int start = caddyfile.indexOf("(" + name + ") {");
        assertThat(start).as("the deployment defines the %s snippet", name).isNotNegative();
        int depth = 0;
        for (int cursor = start; cursor < caddyfile.length(); cursor++) {
            char character = caddyfile.charAt(cursor);
            depth += character == '{' ? 1 : character == '}' ? -1 : 0;
            if (depth == 0 && character == '}') {
                return caddyfile.substring(start, cursor + 1);
            }
        }
        throw new AssertionError("The " + name + " snippet is not closed");
    }

    private static String deployedCaddy() throws IOException {
        Matcher image = CADDY_IMAGE.matcher(Files.readString(Path.of("deploy", "compose.yaml")));
        assertThat(image.find()).as("the deployment pins a Caddy image").isTrue();
        return image.group();
    }

    private static MountableFile forString(String content) throws IOException {
        Path file = Files.createTempFile("courtside-proxy-", ".probe");
        Files.writeString(file, content);
        return MountableFile.forHostPath(file);
    }

    private static Path written(String material) throws IOException {
        return Files.writeString(Files.createTempFile("courtside-served-", ".pem"), material,
                StandardCharsets.UTF_8);
    }
}
