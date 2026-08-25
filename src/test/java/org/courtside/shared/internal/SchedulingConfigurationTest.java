package org.courtside.shared.internal;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.annotation.ScheduledAnnotationBeanPostProcessor;
import org.springframework.scheduling.config.ScheduledTaskHolder;

import static org.assertj.core.api.Assertions.assertThat;

class SchedulingConfigurationTest {

    @Test
    void whenSchedulingIsNotConfigured_thenScheduledJobsAreEnabled() {
        // given
        try (var context = new AnnotationConfigApplicationContext(SchedulingConfiguration.class)) {
            // when
            var schedulers = context.getBeansOfType(ScheduledAnnotationBeanPostProcessor.class);

            // then
            assertThat(schedulers).hasSize(1);
        }
    }

    @Test
    void givenAScheduledMethod_whenSchedulingIsNotConfigured_thenTheMethodIsRegistered() {
        // given
        try (var context = new AnnotationConfigApplicationContext()) {
            context.register(SchedulingConfiguration.class, ScheduledJob.class);

            // when
            context.refresh();

            // then
            assertThat(context.getBean(ScheduledTaskHolder.class).getScheduledTasks()).hasSize(1);
        }
    }

    static class ScheduledJob {

        @Scheduled(fixedDelayString = "PT1H")
        void run() {
        }
    }
}
