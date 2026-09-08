package org.courtside.shared;

import org.junit.jupiter.api.Test;
import org.springframework.boot.diagnostics.FailureAnalysis;
import org.springframework.mock.env.MockEnvironment;

import java.sql.SQLException;

import static org.assertj.core.api.Assertions.assertThat;

class DatabaseRuntimeIdentityFailureAnalyzerTest {

    @Test
    void givenARefusedSeparateRuntimeCredential_whenStartupIsDiagnosed_thenReplacementIsActionable() {
        // given
        SQLException refusal = new SQLException("password authentication failed", "28P01");

        // when
        FailureAnalysis analysis = analyzer("separate").analyze(refusal);

        // then
        assertThat(analysis.getDescription()).contains("runtime credential was refused");
        assertThat(analysis.getAction())
                .contains("COURTSIDE_DB_RUNTIME_PASSWORD_FILE")
                .contains("recreate the application");
    }

    @Test
    void givenTheSharedCredentialPath_whenAuthenticationIsRefused_thenTheAnalyzerStaysSilent() {
        // when
        FailureAnalysis analysis = analyzer("shared")
                .analyze(new SQLException("password authentication failed", "28P01"));

        // then
        assertThat(analysis).isNull();
    }

    @Test
    void givenAnUnrelatedDatabaseFailure_whenStartupIsDiagnosed_thenTheAnalyzerStaysSilent() {
        // when
        FailureAnalysis analysis = analyzer("separate")
                .analyze(new SQLException("connection refused", "08001"));

        // then
        assertThat(analysis).isNull();
    }

    private static DatabaseRuntimeIdentityFailureAnalyzer analyzer(String mode) {
        return new DatabaseRuntimeIdentityFailureAnalyzer(new MockEnvironment()
                .withProperty("courtside.database.identity.mode", mode));
    }
}
