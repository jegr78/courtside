package org.courtside.notification.internal;

import jakarta.mail.internet.MimeMessage;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManagerFactory;
import org.courtside.TestCertificate;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;
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
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

// The reference deployment reaches its relay under the name on its certificate, so both directions
// are proven here: the name it carries is accepted, and every other one is refused.
class MailRelayCertificateTest {

    private static final Path MAIL_DEPLOYMENT = Path.of("deploy", "compose.mail-smoke.yaml");
    private static final Pattern MAILPIT_IMAGE =
            Pattern.compile("axllent/mailpit:[\\w.-]+@sha256:[a-f0-9]{64}");
    private static final String CERTIFICATE_NAME = "localhost";
    private static final String A_NAME_NOT_ON_IT = "127.0.0.1";

    private static GenericContainer<?> relay;
    private static TestCertificate issued;

    @BeforeAll
    static void startARelayServingOneNameOfItsOwn() throws Exception {
        issued = TestCertificate.issuedFor(CERTIFICATE_NAME);
        relay = relayServing(issued);
        relay.start();
    }

    @AfterAll
    static void stopTheRelay() {
        if (relay != null) {
            relay.stop();
        }
    }

    @Test
    void whenTheRelayServesItsCertificate_thenItNamesOneHostAndNoOther() throws Exception {
        // when — the premise every test below rests on, which nothing had been asserting
        X509Certificate served = (X509Certificate) CertificateFactory.getInstance("X.509")
                .generateCertificate(new ByteArrayInputStream(
                        issued.certificate().getBytes(StandardCharsets.UTF_8)));

        // then
        assertThat(served.getSubjectAlternativeNames())
                .extracting(name -> String.valueOf(name.get(1)))
                .containsExactly(CERTIFICATE_NAME);
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
                .hasStackTraceContaining("unable to find valid certification path");
    }

    @Test
    void givenNoCertificateException_whenTheRelayCarriesTheNameItIsReachedUnder_thenTheMessageArrives()
            throws Exception {
        // given
        JavaMailSender sender = senderAnchoredIn(issued.authority(), CERTIFICATE_NAME,
                relay.getMappedPort(1025));

        // when
        sender.send(aMessage(sender, "verified@example.org"));

        // then
        assertThat(mailbox()).contains("verified@example.org");
    }

    @Test
    void givenNoCertificateException_whenTheRelayCarriesAnotherName_thenTheNameIsRefused()
            throws Exception {
        // given — the issuer checks out, so only the name can decide this
        JavaMailSender sender = senderAnchoredIn(issued.authority(), A_NAME_NOT_ON_IT,
                relay.getMappedPort(1025));

        // when / then
        assertThatThrownBy(() -> sender.send(aMessage(sender, "misnamed@example.org")))
                .isInstanceOf(MailException.class)
                .hasStackTraceContaining("No subject alternative names matching IP address "
                        + A_NAME_NOT_ON_IT);
    }

    @Test
    void givenNoCertificateException_whenTheRelayCertificateHasRunOut_thenTheRelayIsRefused()
            throws Exception {
        // given
        TestCertificate spent = TestCertificate.expiredFor(CERTIFICATE_NAME);
        try (GenericContainer<?> outdated = relayServing(spent)) {
            outdated.start();
            JavaMailSender sender = senderAnchoredIn(spent.authority(), CERTIFICATE_NAME,
                    outdated.getMappedPort(1025));
            // The socket factory carrying the anchor would answer for a relay this configuration
            // had already decided to trust outright, and the dates would then decide nothing.
            assertThat(((JavaMailSenderImpl) sender).getJavaMailProperties())
                    .doesNotContainKey("mail.smtp.ssl.trust");

            // when / then
            assertThatThrownBy(() -> sender.send(aMessage(sender, "outdated@example.org")))
                    .isInstanceOf(MailException.class)
                    .hasStackTraceContaining("CertificateExpiredException");
        }
    }

    @Test
    void givenAnAbsoluteSearchDirectory_whenResolvingAnExecutable_thenItsNormalizedPathIsReturned(
            @TempDir Path directory) throws IOException {
        // given
        Path executable = executableFile(directory, "openssl");

        // when
        Path resolved = TestCertificate.executable("openssl", List.of(directory), List.of(""));

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
            assertThatThrownBy(() -> TestCertificate.executable("openssl", List.of(directory), List.of("")))
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
        Path resolved = TestCertificate.executable("openssl", List.of(directory), List.of(".exe"));

        // then
        assertThat(resolved).isEqualTo(executable.toAbsolutePath().normalize());
    }

    @Test
    void givenNoMatchingExecutable_whenResolvingAnExecutable_thenResolutionFailsClosed(
            @TempDir Path directory) {
        // given / when / then
        assertThatThrownBy(() -> TestCertificate.executable("openssl", List.of(directory), List.of("")))
                .isInstanceOf(IllegalStateException.class);
    }

    private JavaMailSender senderTrusting(boolean trustRelayCertificate) {
        return new NotificationConfiguration().courtsideMailSender(new MailProperties(
                A_NAME_NOT_ON_IT, relay.getMappedPort(1025), "no-reply@example.org",
                "board@example.org", null, null, trustRelayCertificate));
    }

    // The deployment anchors the relay in the runtime's own store, which no test may write into;
    // an anchor handed to this one sender says the same thing without touching the machine.
    private JavaMailSender senderAnchoredIn(String anchor, String host, int port) throws Exception {
        JavaMailSenderImpl sender = (JavaMailSenderImpl) new NotificationConfiguration()
                .courtsideMailSender(new MailProperties(host, port, "no-reply@example.org",
                        "board@example.org", null, null, false));
        sender.getJavaMailProperties().put("mail.smtp.ssl.socketFactory", trusting(anchor));
        return sender;
    }

    private static SSLSocketFactory trusting(String anchor) throws Exception {
        KeyStore anchors = KeyStore.getInstance(KeyStore.getDefaultType());
        anchors.load(null, null);
        anchors.setCertificateEntry("relay", CertificateFactory.getInstance("X.509")
                .generateCertificate(new ByteArrayInputStream(
                        anchor.getBytes(StandardCharsets.UTF_8))));
        TrustManagerFactory authorities =
                TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        authorities.init(anchors);
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, authorities.getTrustManagers(), null);
        return context.getSocketFactory();
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

    private static GenericContainer<?> relayServing(TestCertificate pair) throws IOException {
        return new GenericContainer<>(DockerImageName.parse(deployedImage()))
                .withEnv("MP_SMTP_TLS_CERT", "/etc/mailpit/cert.pem")
                .withEnv("MP_SMTP_TLS_KEY", "/etc/mailpit/key.pem")
                .withCopyToContainer(Transferable.of(pair.certificate()), "/etc/mailpit/cert.pem")
                .withCopyToContainer(Transferable.of(pair.key()), "/etc/mailpit/key.pem")
                .withExposedPorts(1025, 8025)
                .waitingFor(Wait.forHttp("/readyz").forPort(8025));
    }

    private static String deployedImage() throws IOException {
        Matcher found = MAILPIT_IMAGE.matcher(Files.readString(MAIL_DEPLOYMENT));
        if (!found.find()) {
            throw new IllegalStateException(MAIL_DEPLOYMENT + " names no Mailpit image pinned by digest");
        }
        return found.group();
    }
}
