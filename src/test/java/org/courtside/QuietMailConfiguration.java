package org.courtside;

import jakarta.mail.internet.MimeMessage;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.core.task.SyncTaskExecutor;
import org.springframework.core.task.TaskExecutor;

@TestConfiguration(proxyBeanMethods = false)
class QuietMailConfiguration {

    @Bean
    @Primary
    JavaMailSender quietMailSender() {
        return new JavaMailSenderImpl() {
            @Override
            public void send(MimeMessage message) {
            }
        };
    }

    // On the caller's thread, so a message is written before the test method returns and the
    // outbox cannot race the truncation that follows it.
    @Bean
    TaskExecutor mailOutboxExecutor() {
        return new SyncTaskExecutor();
    }

    @Bean
    TaskExecutor closureAnnouncementExecutor() {
        return new SyncTaskExecutor();
    }
}
