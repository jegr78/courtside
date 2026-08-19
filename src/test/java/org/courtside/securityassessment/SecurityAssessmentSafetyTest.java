package org.courtside.securityassessment;

import org.junit.jupiter.api.Test;
import org.springframework.boot.DefaultApplicationArguments;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SecurityAssessmentSafetyTest {

    @Test
    void givenDisposableUseWasNotConfirmed_whenGuardingSecurityAssessment_thenStartupIsRejected() {
        // given
        SecurityAssessmentEnvironmentGuard guard = new SecurityAssessmentEnvironmentGuard(
                mock(DataSource.class), new SecurityAssessmentProperties(false, "run-01", "fingerprint", "password"),
                "SECURITY");

        // when / then
        assertThatThrownBy(() -> guard.run(new DefaultApplicationArguments(new String[0])))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("COURTSIDE_SECURITY_CONFIRM_DISPOSABLE");
    }

    @Test
    void givenWrongMarker_whenGuardingSecurityAssessment_thenStartupIsRejected() {
        // given
        SecurityAssessmentEnvironmentGuard guard = new SecurityAssessmentEnvironmentGuard(
                mock(DataSource.class), new SecurityAssessmentProperties(true, "run-01", "fingerprint", "password"),
                "UAT");

        // when / then
        assertThatThrownBy(() -> guard.run(new DefaultApplicationArguments(new String[0])))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("COURTSIDE_ENVIRONMENT=SECURITY");
    }

    @Test
    void givenRemoteDatabase_whenGuardingSecurityAssessment_thenStartupIsRejected() throws Exception {
        // given
        DataSource dataSource = dataSource("jdbc:postgresql://database.example.org:5432/courtside_security");
        SecurityAssessmentEnvironmentGuard guard = new SecurityAssessmentEnvironmentGuard(
                dataSource, new SecurityAssessmentProperties(true, "run-01",
                        SecurityAssessmentDataSeeder.SEED_FINGERPRINT,
                        "long-test-password"), "SECURITY");

        // when / then
        assertThatThrownBy(() -> guard.run(new DefaultApplicationArguments(new String[0])))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Compose database host db");
    }

    @Test
    void givenAnotherDatasetFingerprint_whenGuardingSecurityAssessment_thenStartupIsRejected() {
        // given
        SecurityAssessmentEnvironmentGuard guard = new SecurityAssessmentEnvironmentGuard(
                mock(DataSource.class), new SecurityAssessmentProperties(true, "run-01",
                        "sha256:" + "a".repeat(64), "long-test-password"), "SECURITY");

        // when / then
        assertThatThrownBy(() -> guard.run(new DefaultApplicationArguments(new String[0])))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("does not match this dataset");
    }

    @Test
    void givenCompleteLocalIdentity_whenGuardingSecurityAssessment_thenStartupIsAllowed() throws Exception {
        // given
        SecurityAssessmentEnvironmentGuard guard = new SecurityAssessmentEnvironmentGuard(
                dataSource("jdbc:postgresql://db:5432/courtside_security"),
                new SecurityAssessmentProperties(true, "run-01", SecurityAssessmentDataSeeder.SEED_FINGERPRINT,
                        "long-test-password"), "SECURITY");

        // when / then
        assertThatCode(() -> guard.run(new DefaultApplicationArguments(new String[0])))
                .doesNotThrowAnyException();
    }

    private DataSource dataSource(String url) throws Exception {
        DataSource dataSource = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        DatabaseMetaData metadata = mock(DatabaseMetaData.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.getMetaData()).thenReturn(metadata);
        when(metadata.getURL()).thenReturn(url);
        return dataSource;
    }
}
