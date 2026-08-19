package org.courtside.securityassessment;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.SQLException;
import java.util.regex.Pattern;

@Component
@Profile("security")
@Order(-100)
class SecurityAssessmentEnvironmentGuard implements ApplicationRunner {

    private static final Pattern RUN_ID = Pattern.compile("[a-zA-Z0-9][a-zA-Z0-9._-]{5,63}");
    private static final Pattern FINGERPRINT = Pattern.compile("sha256:[a-f0-9]{64}");

    private final DataSource dataSource;
    private final SecurityAssessmentProperties properties;
    private final String environmentMarker;

    SecurityAssessmentEnvironmentGuard(DataSource dataSource, SecurityAssessmentProperties properties,
                                       @Value("${courtside.environment}") String environmentMarker) {
        this.dataSource = dataSource;
        this.properties = properties;
        this.environmentMarker = environmentMarker;
    }

    @Override
    public void run(ApplicationArguments arguments) throws SQLException {
        if (!properties.confirmDisposable()) {
            throw new IllegalStateException(
                    "COURTSIDE_SECURITY_CONFIRM_DISPOSABLE=true is required for the security profile");
        }
        if (!"SECURITY".equals(environmentMarker)) {
            throw new IllegalStateException("The security profile requires COURTSIDE_ENVIRONMENT=SECURITY");
        }
        if (properties.runId() == null || !RUN_ID.matcher(properties.runId()).matches()) {
            throw new IllegalStateException("COURTSIDE_SECURITY_RUN_ID must identify this isolated run");
        }
        if (properties.seedFingerprint() == null
                || !FINGERPRINT.matcher(properties.seedFingerprint()).matches()
                || !SecurityAssessmentDataSeeder.SEED_FINGERPRINT.equals(properties.seedFingerprint())) {
            throw new IllegalStateException("COURTSIDE_SECURITY_SEED_FINGERPRINT does not match this dataset");
        }
        if (properties.sharedPassword() == null || properties.sharedPassword().length() < 16) {
            throw new IllegalStateException("COURTSIDE_SECURITY_SHARED_PASSWORD must contain at least 16 characters");
        }
        try (var connection = dataSource.getConnection()) {
            String url = connection.getMetaData().getURL();
            if (url != null && url.matches("jdbc:postgresql://db(?::[0-9]+)?/courtside_security(?:\\?.*)?")) {
                return;
            }
            if (url != null && url.matches("jdbc:postgresql://[^/]+/courtside_security(?:\\?.*)?")) {
                throw new IllegalStateException("The security profile requires the Compose database host db");
            }
            throw new IllegalStateException(
                    "The security profile requires a PostgreSQL database named courtside_security");
        }
    }
}
