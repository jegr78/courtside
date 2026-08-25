package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.scheduling.annotation.ScheduledAnnotationBeanPostProcessor;

import static org.assertj.core.api.Assertions.assertThat;

class SchedulingIsolationTest extends AbstractIntegrationTest {

    @Autowired
    private ConfigurableApplicationContext context;

    @Test
    void whenTheIntegrationContextStarts_thenAutonomousSchedulingIsDisabled() {
        // when
        var schedulers = context.getBeansOfType(ScheduledAnnotationBeanPostProcessor.class);

        // then
        assertThat(context.getEnvironment().getActiveProfiles()).contains("test");
        assertThat(schedulers).isEmpty();
    }
}
