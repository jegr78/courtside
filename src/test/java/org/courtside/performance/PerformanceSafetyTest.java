package org.courtside.performance;

import org.junit.jupiter.api.Test;
import org.springframework.boot.DefaultApplicationArguments;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PerformanceSafetyTest {

    @Test
    void givenDisposableUseWasNotConfirmed_whenGuardingPerformance_thenStartupIsRejected() {
        // given
        PerformanceEnvironmentGuard guard = new PerformanceEnvironmentGuard(
                mock(DataSource.class), new PerformanceProperties(false, "password"), "PERFORMANCE");

        // when / then
        assertThatThrownBy(() -> guard.run(new DefaultApplicationArguments(new String[0])))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("COURTSIDE_PERF_CONFIRM_DISPOSABLE");
    }

    @Test
    void givenWrongEnvironmentMarker_whenGuardingPerformance_thenStartupIsRejected() {
        // given
        PerformanceEnvironmentGuard guard = new PerformanceEnvironmentGuard(
                mock(DataSource.class), new PerformanceProperties(true, "password"), "UAT");

        // when / then
        assertThatThrownBy(() -> guard.run(new DefaultApplicationArguments(new String[0])))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("COURTSIDE_ENVIRONMENT=PERFORMANCE");
    }

    @Test
    void givenWrongDatabaseName_whenGuardingPerformance_thenStartupIsRejected() throws Exception {
        // given
        DataSource dataSource = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        DatabaseMetaData metadata = mock(DatabaseMetaData.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.getMetaData()).thenReturn(metadata);
        when(metadata.getURL()).thenReturn("jdbc:postgresql://db:5432/courtside");
        PerformanceEnvironmentGuard guard = new PerformanceEnvironmentGuard(
                dataSource, new PerformanceProperties(true, "password"), "PERFORMANCE");

        // when / then
        assertThatThrownBy(() -> guard.run(new DefaultApplicationArguments(new String[0])))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("courtside_perf");
    }

    @Test
    void givenRemotePerformanceDatabase_whenGuardingPerformance_thenStartupIsRejected() throws Exception {
        // given
        DataSource dataSource = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        DatabaseMetaData metadata = mock(DatabaseMetaData.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.getMetaData()).thenReturn(metadata);
        when(metadata.getURL()).thenReturn("jdbc:postgresql://database.example.org:5432/courtside_perf");
        PerformanceEnvironmentGuard guard = new PerformanceEnvironmentGuard(
                dataSource, new PerformanceProperties(true, "password"), "PERFORMANCE");

        // when / then
        assertThatThrownBy(() -> guard.run(new DefaultApplicationArguments(new String[0])))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Compose database host db");
    }
}
