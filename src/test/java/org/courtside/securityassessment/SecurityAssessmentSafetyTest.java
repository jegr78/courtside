package org.courtside.securityassessment;

import org.junit.jupiter.api.Test;
import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.core.io.support.SpringFactoriesLoader;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SecurityAssessmentSafetyTest {

    @Test
    void givenDisposableUseWasNotConfirmed_whenGuardingSecurityAssessment_thenStartupIsRejected() {
        // given
        MockEnvironment environment = validEnvironment()
                .withProperty("courtside.security-assessment.confirm-disposable", "false");

        // when / then
        assertThatThrownBy(() -> SecurityAssessmentEnvironmentGuard.validate(environment))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("COURTSIDE_SECURITY_CONFIRM_DISPOSABLE");
    }

    @Test
    void givenWrongMarker_whenGuardingSecurityAssessment_thenStartupIsRejected() {
        // given
        MockEnvironment environment = validEnvironment().withProperty("courtside.environment", "UAT");

        // when / then
        assertThatThrownBy(() -> SecurityAssessmentEnvironmentGuard.validate(environment))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("COURTSIDE_ENVIRONMENT=SECURITY");
    }

    @Test
    void givenRemoteDatabase_whenGuardingSecurityAssessment_thenStartupIsRejected() {
        // given
        MockEnvironment environment = validEnvironment().withProperty(
                "spring.datasource.url", "jdbc:postgresql://database.example.org:5432/courtside_security");

        // when / then
        assertThatThrownBy(() -> SecurityAssessmentEnvironmentGuard.validate(environment))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Compose database host db");
    }

    @Test
    void givenAnotherDatasetFingerprint_whenGuardingSecurityAssessment_thenStartupIsRejected() {
        // given
        MockEnvironment environment = validEnvironment().withProperty(
                "courtside.security-assessment.seed-fingerprint", "sha256:" + "a".repeat(64));

        // when / then
        assertThatThrownBy(() -> SecurityAssessmentEnvironmentGuard.validate(environment))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("does not match this dataset");
    }

    @Test
    void givenSecurityProfileWithoutDatabase_whenProcessingEnvironment_thenGuardRejectsBeforeContextStartup() {
        // given
        MockEnvironment environment = validEnvironment();
        environment.setActiveProfiles("security");
        environment.setProperty("spring.datasource.url", "jdbc:postgresql://remote.example.org/courtside_security");

        // when / then
        assertThatThrownBy(() -> new SecurityAssessmentEnvironmentGuard().postProcessEnvironment(environment, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Compose database host db");
    }

    @Test
    void whenLoadingEnvironmentProcessors_thenSecurityGuardRunsBeforeContextCreation() {
        // when
        var processorNames = SpringFactoriesLoader.loadFactoryNames(
                EnvironmentPostProcessor.class, SecurityAssessmentSafetyTest.class.getClassLoader());

        // then
        assertThat(processorNames).contains(SecurityAssessmentEnvironmentGuard.class.getName());
    }

    private MockEnvironment validEnvironment() {
        return new MockEnvironment()
                .withProperty("courtside.environment", "SECURITY")
                .withProperty("courtside.security-assessment.confirm-disposable", "true")
                .withProperty("courtside.security-assessment.run-id", "run-01")
                .withProperty("courtside.security-assessment.seed-fingerprint",
                        SecurityAssessmentDataset.fingerprint())
                .withProperty("courtside.security-assessment.shared-password", "long-test-password")
                .withProperty("spring.datasource.url", "jdbc:postgresql://db:5432/courtside_security");
    }
}
