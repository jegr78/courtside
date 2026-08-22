package org.courtside.notification.internal;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;

import java.nio.charset.StandardCharsets;
import java.util.Properties;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(MailProperties.class)
class NotificationConfiguration {

    // Built from this module's own settings rather than from spring.mail, so what an operator sets
    // and what is validated at startup are the same six values and not two overlapping sets.
    @Bean
    JavaMailSender courtsideMailSender(MailProperties properties) {
        MailSettings.verify(properties);
        JavaMailSenderImpl sender = new JavaMailSenderImpl();
        sender.setHost(properties.host());
        sender.setPort(properties.port());
        sender.setDefaultEncoding(StandardCharsets.UTF_8.name());
        if (MailSettings.isSet(properties.username())) {
            sender.setUsername(properties.username());
            sender.setPassword(properties.password());
        }
        Properties mail = sender.getJavaMailProperties();
        mail.put("mail.smtp.auth", String.valueOf(MailSettings.isSet(properties.username())));
        mail.put("mail.smtp.starttls.enable", "true");
        mail.put("mail.smtp.starttls.required", "true");
        if (properties.trustRelayCertificate()) {
            mail.put("mail.smtp.ssl.trust", properties.host());
        }
        mail.put("mail.smtp.timeout", "10000");
        mail.put("mail.smtp.connectiontimeout", "10000");
        sender.setJavaMailProperties(mail);
        return sender;
    }
}
