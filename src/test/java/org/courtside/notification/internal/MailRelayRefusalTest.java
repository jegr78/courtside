package org.courtside.notification.internal;

import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.mail.javamail.JavaMailSender;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.images.builder.Transferable;
import org.testcontainers.utility.DockerImageName;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

// A hand-built SendFailedException is not what a relay produces: Spring collects the failure of one
// message into MailSendException's failedMessages, where no walk of the cause chain ever sees it.
class MailRelayRefusalTest {

    private static final Path MAIL_DEPLOYMENT = Path.of("deploy", "compose.mail-smoke.yaml");
    private static final Pattern MAILPIT_IMAGE =
            Pattern.compile("axllent/mailpit:[\\w.-]+@sha256:[a-f0-9]{64}");
    private static final String ACCEPTED = "member@example.org";
    private static final String REFUSED = "member@exmaple.org";

    private static GenericContainer<?> relay;

    @BeforeAll
    static void startARelayThatRefusesWhatDoesNotExist() throws Exception {
        TestRelayCertificate issued = TestRelayCertificate.issuedFor("localhost");
        relay = new GenericContainer<>(DockerImageName.parse(deployedImage()))
                .withEnv("MP_SMTP_TLS_CERT", "/etc/mailpit/cert.pem")
                .withEnv("MP_SMTP_TLS_KEY", "/etc/mailpit/key.pem")
                .withEnv("MP_SMTP_ALLOWED_RECIPIENTS", "@example\\.org$")
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
    void givenARecipientARealRelayRejects_whenHandingOver_thenItIsRefusedOnTheFirstAttempt() {
        // given
        List<java.time.Duration> gaps = new ArrayList<>();
        MailHandover handover = new MailHandover(gaps::add);
        JavaMailSender sender = sender();

        // when / then — an address nobody holds will not start existing between attempts
        MailRecipientRefusedException refusal = catchThrowableOfType(MailRecipientRefusedException.class,
                () -> handover.attempt("<a-message-id@example.org>", () -> send(sender, REFUSED)));
        assertThat(gaps).isEmpty();
        assertThat(refusal.diagnosis()).contains("SendFailedException");
        assertThat(refusal.statusCode()).matches("[45]\\d\\d");
    }

    @Test
    void givenARecipientARealRelayRejects_whenItIsRecorded_thenNeitherTheAddressNorItsWordsAreKept() {
        // given
        MailHandover handover = new MailHandover(gap -> {
        });
        JavaMailSender sender = sender();

        // when
        MailRecipientRefusedException refusal = catchThrowableOfType(MailRecipientRefusedException.class,
                () -> handover.attempt("<a-message-id@example.org>", () -> send(sender, REFUSED)));

        // then — what is stored says which kind of failure it was, and nothing about who it was to
        assertThat(refusal.diagnosis()).doesNotContain(REFUSED).doesNotContain("exmaple");
        assertThat(refusal.statusCode()).doesNotContain(REFUSED);
    }

    @Test
    void givenARecipientARealRelayAccepts_whenHandingOver_thenNothingIsRefused() {
        // given
        MailHandover handover = new MailHandover(gap -> {
        });
        JavaMailSender sender = sender();

        // when / then — the refusal must name the rejected recipient, not every failure there is
        handover.attempt("<a-message-id@example.org>", () -> send(sender, ACCEPTED));
        assertThatThrownBy(() -> send(sender, REFUSED)).isInstanceOf(RuntimeException.class);
    }

    private JavaMailSender sender() {
        return new NotificationConfiguration().courtsideMailSender(new MailProperties(
                relay.getHost(), relay.getMappedPort(1025), "no-reply@example.org",
                "board@example.org", null, null, true));
    }

    private void send(JavaMailSender sender, String recipient) {
        try {
            MimeMessage message = sender.createMimeMessage();
            message.setFrom("no-reply@example.org");
            message.setRecipients(MimeMessage.RecipientType.TO, recipient);
            message.setSubject("Handover");
            message.setText("Handover");
            sender.send(message);
        } catch (jakarta.mail.MessagingException failure) {
            throw new IllegalStateException("Could not build the message under test", failure);
        }
    }

    private static String deployedImage() throws IOException {
        Matcher found = MAILPIT_IMAGE.matcher(Files.readString(MAIL_DEPLOYMENT));
        if (!found.find()) {
            throw new IllegalStateException(MAIL_DEPLOYMENT + " names no Mailpit image pinned by digest");
        }
        return found.group();
    }
}
