package org.courtside.notification.internal;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.context.PropertyPlaceholderAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;

import static org.assertj.core.api.Assertions.assertThat;

class MailSettingsTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(PropertyPlaceholderAutoConfiguration.class))
            .withUserConfiguration(NotificationConfiguration.class);

    @Test
    void givenACompleteConfiguration_whenTheContextStarts_thenASenderIsAvailable() {
        // given
        ApplicationContextRunner runner = contextRunner.withPropertyValues(
                "courtside.mail.host=mail", "courtside.mail.port=587",
                "courtside.mail.from=no-reply@courts.example.org",
                "courtside.mail.reply-to=board@courts.example.org");

        // when / then
        runner.run(context -> assertThat(context).hasSingleBean(JavaMailSender.class));
    }

    private static java.util.Properties settings(
            org.springframework.context.ApplicationContext context) {
        return ((JavaMailSenderImpl) context.getBean(JavaMailSender.class)).getJavaMailProperties();
    }

    @Test
    void givenNoCertificateException_whenTheContextStarts_thenTheRelayHasToProveWhoItIs() {
        // given
        ApplicationContextRunner runner = contextRunner.withPropertyValues(
                "courtside.mail.host=relay.example.org",
                "courtside.mail.from=no-reply@courts.example.org",
                "courtside.mail.reply-to=board@courts.example.org");

        // when / then
        runner.run(context -> assertThat(settings(context))
                .containsEntry("mail.smtp.starttls.required", "true")
                .doesNotContainKey("mail.smtp.ssl.trust"));
    }

    @Test
    void givenTheCertificateException_whenTheContextStarts_thenItCoversTheConfiguredRelayOnly() {
        // given
        ApplicationContextRunner runner = contextRunner.withPropertyValues(
                "courtside.mail.host=mail", "courtside.mail.trust-relay-certificate=true",
                "courtside.mail.from=no-reply@courts.example.org",
                "courtside.mail.reply-to=board@courts.example.org");

        // when / then — the exception covers the issuer, and the name the relay proves stays checked
        runner.run(context -> assertThat(settings(context))
                .containsEntry("mail.smtp.ssl.trust", "mail")
                .doesNotContainKey("mail.smtp.ssl.checkserveridentity"));
    }

    @Test
    void givenNoRelayAndNoSender_whenTheContextStarts_thenItRefusesAndNamesBothVariables() {
        // given
        ApplicationContextRunner runner = contextRunner.withPropertyValues(
                "courtside.mail.host=", "courtside.mail.from=",
                "courtside.mail.reply-to=board@courts.example.org");

        // when / then
        runner.run(context -> assertThat(context).getFailure().rootCause()
                .hasMessageContaining("COURTSIDE_MAIL_RELAY_HOST")
                .hasMessageContaining("COURTSIDE_MAIL_FROM")
                .hasMessageNotContaining("COURTSIDE_MAIL_REPLY_TO"));
    }

    @Test
    void givenASenderThatIsNotAnAddress_whenTheContextStarts_thenItRefusesAndNamesTheVariable() {
        // given
        ApplicationContextRunner runner = contextRunner.withPropertyValues(
                "courtside.mail.host=mail", "courtside.mail.from=the club",
                "courtside.mail.reply-to=board@courts.example.org");

        // when / then
        runner.run(context -> assertThat(context).getFailure().rootCause()
                .hasMessageContaining("COURTSIDE_MAIL_FROM"));
    }

    @Test
    void givenAUsernameWithoutAPassword_whenTheContextStarts_thenItRefusesAndNamesThePassword() {
        // given
        ApplicationContextRunner runner = contextRunner.withPropertyValues(
                "courtside.mail.host=mail", "courtside.mail.from=no-reply@courts.example.org",
                "courtside.mail.reply-to=board@courts.example.org",
                "courtside.mail.username=courtside@courts.example.org");

        // when / then
        runner.run(context -> assertThat(context).getFailure().rootCause()
                .hasMessageContaining("COURTSIDE_MAIL_PASSWORD"));
    }
}
