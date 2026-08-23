package org.courtside.notification.internal;

import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSender;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.images.builder.Transferable;
import org.testcontainers.utility.DockerImageName;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
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

    @BeforeAll
    static void startARelayNamingSomethingElse() throws Exception {
        Certificate issued = issuedFor(UNREACHABLE_NAME);
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
    private static Certificate issuedFor(String name) throws Exception {
        Path directory = Files.createTempDirectory("courtside-relay-");
        Path certificate = directory.resolve("cert.pem");
        Path key = directory.resolve("key.pem");
        Process openssl = new ProcessBuilder("openssl", "req", "-x509", "-newkey", "rsa:2048",
                "-nodes", "-days", "1", "-subj", "/CN=courtside-relay-under-test",
                "-addext", "subjectAltName=DNS:" + name,
                "-keyout", key.toString(), "-out", certificate.toString())
                .redirectErrorStream(true).start();
        String output = new String(openssl.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        if (openssl.waitFor() != 0) {
            throw new IllegalStateException("Could not issue the relay certificate: " + output);
        }
        return new Certificate(Files.readString(certificate), Files.readString(key));
    }

    private static String deployedImage() throws IOException {
        Matcher found = MAILPIT_IMAGE.matcher(Files.readString(MAIL_DEPLOYMENT));
        if (!found.find()) {
            throw new IllegalStateException(MAIL_DEPLOYMENT + " names no Mailpit image pinned by digest");
        }
        return found.group();
    }

    private record Certificate(String certificate, String key) {
    }
}
