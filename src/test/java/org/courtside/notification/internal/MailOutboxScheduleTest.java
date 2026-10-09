package org.courtside.notification.internal;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.task.TaskExecutor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.config.FixedDelayTask;
import org.springframework.scheduling.config.ScheduledTask;
import org.springframework.scheduling.config.ScheduledTaskHolder;
import org.springframework.transaction.PlatformTransactionManager;

import java.time.Clock;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class MailOutboxScheduleTest {

    @Test
    void whenSchedulingReadsTheOutbox_thenAPassIsRegisteredEveryFiveSeconds() {
        // given
        ApplicationContextRunner runner = new ApplicationContextRunner()
                .withUserConfiguration(OutboxScheduleConfiguration.class);

        // when / then
        runner.run(context -> assertThat(context.getBean(ScheduledTaskHolder.class).getScheduledTasks())
                .singleElement()
                .extracting(ScheduledTask::getTask)
                .isInstanceOfSatisfying(FixedDelayTask.class, task -> {
                    assertThat(task.getIntervalDuration())
                            .as("retries come due and a restart's queue resumes on this cadence")
                            .isEqualTo(Duration.ofSeconds(5));
                    assertThat(task.getInitialDelayDuration()).isEqualTo(Duration.ofSeconds(5));
                }));
    }

    @Configuration(proxyBeanMethods = false)
    @EnableScheduling
    static class OutboxScheduleConfiguration {

        @Bean
        @SuppressWarnings("unchecked")
        MailOutbox mailOutbox() {
            return new MailOutbox(mock(TaskExecutor.class), mock(PlatformTransactionManager.class),
                    mock(JdbcClient.class), mock(MessageRecordRepository.class), mock(ObjectProvider.class),
                    mock(MailDispatch.class), new MailHandover(), mock(MessageLog.class), Clock.systemUTC());
        }
    }
}
