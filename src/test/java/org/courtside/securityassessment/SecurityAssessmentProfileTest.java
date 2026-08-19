package org.courtside.securityassessment;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

class SecurityAssessmentProfileTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(SecurityAssessmentConfiguration.class);

    @Test
    void givenSecurityProfileIsInactive_whenCreatingContext_thenSecurityBeansAreAbsent() {
        // when / then
        contextRunner.run(context -> {
            assertThat(context).doesNotHaveBean(SecurityAssessmentEnvironmentGuard.class);
            assertThat(context).doesNotHaveBean(SecurityAssessmentDataSeeder.class);
        });
    }
}
