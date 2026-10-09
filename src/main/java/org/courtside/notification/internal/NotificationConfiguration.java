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
import java.util.concurrent.ThreadPoolExecutor;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(MailProperties.class)
class NotificationConfiguration {

    // Only woken by publishers, never run by them: a pass already waiting in the queue will find
    // whatever a discarded wake-up would have found.
    @Bean
    @ConditionalOnMissingBean(name = "mailOutboxExecutor")
    TaskExecutor mailOutboxExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(1);
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.DiscardPolicy());
        executor.setThreadNamePrefix("mail-outbox-");
        // Inside the container's ten-second stop grace, so a deploy rarely cuts a handover off mid-send.
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(8);
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
        mail.put("mail.smtp.writetimeout", "10000");
        sender.setJavaMailProperties(mail);
        return sender;
    }
}
