package org.courtside;

import jakarta.mail.internet.MimeMessage;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.core.task.SyncTaskExecutor;
import org.springframework.core.task.TaskExecutor;

// Nothing listens on the test relay, and a real attempt costs the handover's whole retry ladder on
// the executor: 5, 15 and 45 seconds of sleeping for every account a test creates.
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

    // On the caller's thread, so a credential is issued before the test method returns and the
    // listener cannot race the truncation that follows it.
    @Bean
    TaskExecutor credentialMailExecutor() {
        return new SyncTaskExecutor();
    }
}
