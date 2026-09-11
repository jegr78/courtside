package org.courtside.securityassessment;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

class SecurityAssessmentSeedCompletionTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withPropertyValues("spring.profiles.active=security")
            .withUserConfiguration(SecurityAssessmentSeedCompletion.class);

    @Test
    void givenAnAssessmentTarget_whenCreatingContext_thenNothingEndsTheProcessAfterSeeding() {
        // when / then
        contextRunner.run(context ->
                assertThat(context).doesNotHaveBean(SecurityAssessmentSeedCompletion.class));
    }

    @Test
    void givenASeedOnlyRunOutsideTheAssessment_whenCreatingContext_thenNothingEndsTheProcess() {
        // when / then
        new ApplicationContextRunner()
                .withPropertyValues("courtside.security-assessment.seed-only=true")
                .withUserConfiguration(SecurityAssessmentSeedCompletion.class)
                .run(context -> assertThat(context).doesNotHaveBean(SecurityAssessmentSeedCompletion.class));
    }

    @Test
    void givenASeedOnlyRun_whenCreatingContext_thenTheProcessEndsAfterSeeding() {
        // when / then
        contextRunner.withPropertyValues("courtside.security-assessment.seed-only=true").run(context ->
                assertThat(context).hasSingleBean(SecurityAssessmentSeedCompletion.class));
    }
}
