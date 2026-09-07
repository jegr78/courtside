package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.config.CronTask;
import org.springframework.scheduling.config.ScheduledTask;
import org.springframework.scheduling.config.ScheduledTaskHolder;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class AgedSessionSweepScheduleTest {

    // Scheduling is off under the test profile, so no integration test processes the annotation at
    // all: a property name that resolves to nothing would first be read at a club's own startup.
    @Test
    void givenTheConfiguredCleanupCadence_whenSchedulingReadsIt_thenTheSweepIsRegisteredOnIt() {
        // given — a cadence that falls due once a year, so the registration is read and not run
        ApplicationContextRunner runner = new ApplicationContextRunner()
                .withUserConfiguration(SweepScheduleConfiguration.class)
                .withPropertyValues("spring.session.jdbc.cleanup-cron=0 0 4 1 1 *");

        // when / then
        runner.run(context -> assertThat(context.getBean(ScheduledTaskHolder.class).getScheduledTasks())
                .singleElement()
                .extracting(ScheduledTask::getTask)
                .isInstanceOfSatisfying(CronTask.class, task -> assertThat(task.getExpression())
                        .as("COURTSIDE_SESSION_CLEANUP_CRON feeds this property, and section 11 of the"
                                + " design specification says a session past its lifetime is swept on it")
                        .isEqualTo("0 0 4 1 1 *")));
    }

    @Configuration(proxyBeanMethods = false)
    @EnableScheduling
    static class SweepScheduleConfiguration {

        @Bean
        AgedSessionSweep agedSessionSweep() {
            return new AgedSessionSweep(mock(JdbcClient.class),
                    new CourtsideSessionProperties(Duration.ofHours(24), 5));
        }
    }
}
