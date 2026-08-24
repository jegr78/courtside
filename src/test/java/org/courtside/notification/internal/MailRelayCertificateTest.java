package org.courtside.notification.internal;

import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSender;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.images.builder.Transferable;
import org.testcontainers.utility.DockerImageName;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

// A relay this deployment can reach serves a certificate naming none of the hosts it is reached at:
// Stalwart generates one for `localhost` alone, and no club's compose network resolves that name.
class MailRelayCertificateTest {

    private static final Path MAIL_DEPLOYMENT = Path.of("deploy", "compose.mail-smoke.yaml");
    private static final Pattern MAILPIT_IMAGE =
            Pattern.compile("axllent/mailpit:[\\w.-]+@sha256:[a-f0-9]{64}");
    private static final String UNREACHABLE_NAME = "localhost";
    private static final String REACHED_AT = "127.0.0.1";

    private static GenericContainer<?> relay;
    private static TestRelayCertificate issued;

    @BeforeAll
    static void startARelayNamingSomethingElse() throws Exception {
        issued = TestRelayCertificate.issuedFor(UNREACHABLE_NAME);
        relay = new GenericContainer<>(DockerImageName.parse(deployedImage()))
                .withEnv("MP_SMTP_TLS_CERT", "/etc/mailpit/cert.pem")
                .withEnv("MP_SMTP_TLS_KEY", "/etc/mailpit/key.pem")
                .withCopyToContainer(Transferable.of(issued.certificate()), "/etc/mailpit/cert.pem")
                .withCopyToContainer(Transferable.of(issued.key()), "/etc/mailpit/key.pem")
                .withExposedPorts(1025, 8025)
                .waitingFor(Wait.forHttp("/readyz").forPort(8025));
        relay.start();
    }

    @AfterAll
    static void stopTheRelay() {
        if (relay != null) {
            relay.stop();
        }
    }

    @Test
    void whenTheRelayServesItsCertificate_thenItNamesNoHostThisTestReachesItAt() throws Exception {
        // when — the premise both tests below rest on, which nothing had been asserting
        X509Certificate served = (X509Certificate) CertificateFactory.getInstance("X.509")
                .generateCertificate(new ByteArrayInputStream(
                        issued.certificate().getBytes(StandardCharsets.UTF_8)));

        // then
        assertThat(served.getSubjectAlternativeNames())
                .extracting(name -> String.valueOf(name.get(1)))
                .containsExactly(UNREACHABLE_NAME);
    }

    @Test
    void givenTheCertificateException_whenHandingAMessageOver_thenTheRelayIsReachedUnderAnyName()
            throws Exception {
        // given
        JavaMailSender sender = senderTrusting(true);

        // when
        sender.send(aMessage(sender, "reached@example.org"));

        // then — a name on a certificate whose issuer is unchecked cannot decide this
        assertThat(mailbox()).contains("reached@example.org");
    }

    @Test
    void givenNoCertificateException_whenHandingAMessageOver_thenTheRelayHasToProveWhoItIs() {
        // given
        JavaMailSender sender = senderTrusting(false);

        // when / then
        assertThatThrownBy(() -> sender.send(aMessage(sender, "refused@example.org")))
                .isInstanceOf(MailException.class)
                .hasStackTraceContaining("SSLHandshakeException");
    }

    @Test
    void givenAnAbsoluteSearchDirectory_whenResolvingAnExecutable_thenItsNormalizedPathIsReturned(
            @TempDir Path directory) throws IOException {
        // given
        Path executable = executableFile(directory, "openssl");

        // when
        Path resolved = TestRelayCertificate.executable("openssl", List.of(directory), List.of(""));

        // then
        assertThat(resolved).isEqualTo(executable.toAbsolutePath().normalize()).isAbsolute();
    }

    @Test
    void givenOnlyARelativeSearchDirectory_whenResolvingAnExecutable_thenResolutionFailsClosed()
            throws IOException {
        // given
        Path directory = Files.createTempDirectory(Path.of("target"), "relative-executable-search-");
        Path executable = executableFile(directory, "openssl");

        // when / then
        try {
            assertThatThrownBy(() -> TestRelayCertificate.executable("openssl", List.of(directory), List.of("")))
                    .isInstanceOf(IllegalStateException.class);
        } finally {
            Files.deleteIfExists(executable);
            Files.deleteIfExists(directory);
        }
    }

    @Test
    void givenAWindowsExecutableExtension_whenResolvingAnExecutable_thenTheExtensionIsApplied(
            @TempDir Path directory) throws IOException {
        // given
        Path executable = executableFile(directory, "openssl.exe");

        // when
        Path resolved = TestRelayCertificate.executable("openssl", List.of(directory), List.of(".exe"));

        // then
        assertThat(resolved).isEqualTo(executable.toAbsolutePath().normalize());
    }

    @Test
    void givenNoMatchingExecutable_whenResolvingAnExecutable_thenResolutionFailsClosed(
            @TempDir Path directory) {
        // given / when / then
        assertThatThrownBy(() -> TestRelayCertificate.executable("openssl", List.of(directory), List.of("")))
                .isInstanceOf(IllegalStateException.class);
    }

    private JavaMailSender senderTrusting(boolean trustRelayCertificate) {
        return new NotificationConfiguration().courtsideMailSender(new MailProperties(
                REACHED_AT, relay.getMappedPort(1025), "no-reply@example.org",
                "board@example.org", null, null, trustRelayCertificate));
    }

    private MimeMessage aMessage(JavaMailSender sender, String recipient) throws Exception {
        MimeMessage message = sender.createMimeMessage();
        message.setFrom("no-reply@example.org");
        message.setRecipients(MimeMessage.RecipientType.TO, recipient);
        message.setSubject("Handover");
        message.setText("Handover");
        return message;
    }

    private String mailbox() throws Exception {
        HttpResponse<String> response = HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(URI.create("http://" + relay.getHost() + ":"
                        + relay.getMappedPort(8025) + "/api/v1/messages")).build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        return response.body();
    }

    // The JDK exposes no way to write an X.509 certificate, and adding a library to sign one would
    // be a dependency this repository carries for a single test.
    private static Path executableFile(Path directory, String name) throws IOException {
        Path executable = Files.createFile(directory.resolve(name));
        if (!executable.toFile().setExecutable(true)) {
            throw new IllegalStateException("Could not make the test executable available");
        }
        return executable;
    }

    private static String deployedImage() throws IOException {
        Matcher found = MAILPIT_IMAGE.matcher(Files.readString(MAIL_DEPLOYMENT));
        if (!found.find()) {
            throw new IllegalStateException(MAIL_DEPLOYMENT + " names no Mailpit image pinned by digest");
        }
        return found.group();
    }
}
