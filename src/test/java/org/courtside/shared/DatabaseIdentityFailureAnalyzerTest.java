package org.courtside.shared;

import org.junit.jupiter.api.Test;
import org.springframework.boot.diagnostics.FailureAnalysis;

import static org.assertj.core.api.Assertions.assertThat;

class DatabaseIdentityFailureAnalyzerTest {

    @Test
    void givenAnIdentityConfigurationFailure_whenStartupIsDiagnosed_thenTheRemedyIsPreserved() {
        // given
        DatabaseIdentityConfigurationException failure =
                new DatabaseIdentityConfigurationException("The database identity is incomplete.",
                        "Mount the missing credential file.");

        // when
        FailureAnalysis analysis = new DatabaseIdentityFailureAnalyzer().analyze(failure);

        // then
        assertThat(analysis.getDescription()).isEqualTo("The database identity is incomplete.");
        assertThat(analysis.getAction()).isEqualTo("Mount the missing credential file.");
        assertThat(analysis.getCause()).isSameAs(failure);
    }

    @Test
    void givenACommandLineConfigurationFailure_whenItEscapesSpring_thenTheRemedyRemainsVisible() {
        // given
        DatabaseIdentityConfigurationException failure =
                new DatabaseIdentityConfigurationException("The migration credential was refused.",
                        "Replace the mounted migration credential.");

        // when
        String diagnostic = failure.getLocalizedMessage();

        // then
        assertThat(diagnostic)
                .contains("The migration credential was refused.")
                .contains("Action: Replace the mounted migration credential.");
    }
}
