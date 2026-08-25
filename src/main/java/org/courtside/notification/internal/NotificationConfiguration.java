package org.courtside.notification.internal;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.task.TaskExecutor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;

import java.nio.charset.StandardCharsets;
import java.util.Properties;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(MailProperties.class)
class NotificationConfiguration {

    // Handing a message over waits for the relay, and the shared executor also carries the audit
    // trail and every other module's listeners, which must not queue behind a mail server.
    @Bean
    @ConditionalOnMissingBean(name = "outboundMailExecutor")
    TaskExecutor outboundMailExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setThreadNamePrefix("outbound-mail-");
        executor.initialize();
        return executor;
    }

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
        // The name on a certificate whose issuer is already unchecked proves nothing — whoever can
        // redirect the connection writes both — and no name the relay serves has to be reachable.
        if (properties.trustRelayCertificate()) {
            mail.put("mail.smtp.ssl.trust", properties.host());
            mail.put("mail.smtp.ssl.checkserveridentity", "false");
        }
        mail.put("mail.smtp.timeout", "10000");
        mail.put("mail.smtp.connectiontimeout", "10000");
        sender.setJavaMailProperties(mail);
        return sender;
    }
}
