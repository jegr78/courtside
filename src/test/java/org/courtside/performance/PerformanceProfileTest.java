package org.courtside.performance;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

class PerformanceProfileTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(PerformanceConfiguration.class);

    @Test
    void givenPerformanceProfileIsInactive_whenCreatingContext_thenPerformanceBeansAreAbsent() {
        // when / then
        contextRunner.run(context -> {
            assertThat(context).doesNotHaveBean(PerformanceEnvironmentGuard.class);
            assertThat(context).doesNotHaveBean(PerformanceDataSeeder.class);
        });
    }
}
