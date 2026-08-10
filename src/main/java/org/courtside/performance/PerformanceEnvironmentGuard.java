package org.courtside.performance;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.SQLException;

@Component
@Profile("perf")
@Order(-100)
class PerformanceEnvironmentGuard implements ApplicationRunner {

    private final DataSource dataSource;
    private final PerformanceProperties properties;
    private final String environmentMarker;

    PerformanceEnvironmentGuard(DataSource dataSource, PerformanceProperties properties,
                                @Value("${courtside.environment}") String environmentMarker) {
        this.dataSource = dataSource;
        this.properties = properties;
        this.environmentMarker = environmentMarker;
    }

    @Override
    public void run(ApplicationArguments arguments) throws SQLException {
        if (!properties.confirmDisposable()) {
            throw new IllegalStateException(
                    "COURTSIDE_PERF_CONFIRM_DISPOSABLE=true is required for the perf profile");
        }
        if (!"PERFORMANCE".equals(environmentMarker)) {
            throw new IllegalStateException("The perf profile requires COURTSIDE_ENVIRONMENT=PERFORMANCE");
        }
        try (var connection = dataSource.getConnection()) {
            String url = connection.getMetaData().getURL();
            if (url != null && url.matches("jdbc:postgresql://db(?::[0-9]+)?/courtside_perf(?:\\?.*)?")) {
                return;
            }
            if (url != null && url.matches("jdbc:postgresql://[^/]+/courtside_perf(?:\\?.*)?")) {
                throw new IllegalStateException(
                        "The perf profile requires the Compose database host db");
            }
            throw new IllegalStateException(
                    "The perf profile requires a PostgreSQL database named courtside_perf");
        }
    }
}
